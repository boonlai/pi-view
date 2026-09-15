import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { build } from "esbuild";

interface ProbeResult { ok: boolean; error?: string }

test("OMP fullscreen preview wheel scrolls the document, not terminal history, and closing restores modes", { timeout: 60_000 }, async t => {
  const omp = process.env.PI_VIEW_OMP || "omp";
  const installed = spawnSync(omp, ["--version"], { encoding: "utf8", timeout: 5000 });
  if ((installed.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") { t.skip("OMP is not installed"); return; }
  assert.equal(installed.status, 0, installed.stderr);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-omp-scroll-"));
  let child: ChildProcess | undefined;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const resultPath = join(dir, "result.json");
  const fixturePath = join(dir, "fixture.txt");
  const rows = Array.from({ length: 240 }, (_, index) => `SCRL${String(index).padStart(4, "0")} text row for wheel scrolling`);
  await writeFile(fixturePath, rows.join("\n") + "\n");
  const entryPath = join(dir, "probe.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  await build({
    stdin: { contents: String.raw`
      import { writeFileSync } from "node:fs";
      import assert from "node:assert/strict";
      import { setTimeout as delay } from "node:timers/promises";
      import { TUI } from "@earendil-works/pi-tui";
      import { ensureTheme, theme } from "@earendil-works/pi-coding-agent";
      import piView from ${JSON.stringify(join(root, "src/index.ts"))};

      const RESULT_PATH = ${JSON.stringify(resultPath)};
      const FIXTURE_PATH = ${JSON.stringify(fixturePath)};

      // OMP consumes DECRPM before TUI listeners. Model the terminal's side:
      // without mouse reporting, wheel input scrolls history instead of stdin.
      class FakeTerminal {
        constructor() {
          this.writes = [];
          this.modes = new Set();
          this.historyScrolled = 0;
          this.onInput = undefined;
        }
        start(onInput) { this.onInput = onInput; }
        stop() {}
        async drainInput() {}
        write(data) {
          this.writes.push(data);
          for (const match of data.matchAll(/\x1b\[\?(\d+)([hl])/g)) {
            const mode = Number(match[1]);
            if (match[2] === "h") this.modes.add(mode); else this.modes.delete(mode);
          }
        }
        get columns() { return 80; }
        get rows() { return 24; }
        get kittyProtocolActive() { return false; }
        get kittyEnableSequence() { return null; }
        get appearance() { return undefined; }
        moveBy() {}
        hideCursor() {}
        showCursor() {}
        clearLine() {}
        clearFromCursor() {}
        clearScreen() {}
        setTitle() {}
        setProgress() {}
        onAppearanceChange() {}
        joined() { return this.writes.join(""); }
        wheel() {
          if ([1000, 1002, 1003].some(mode => this.modes.has(mode)) && this.modes.has(1006)) this.onInput("\x1b[<65;10;5M");
          else this.historyScrolled += 1;
        }
        key(data) { this.onInput(data); }
      }

      async function waitFor(label, ready) {
        const deadline = Date.now() + 8000;
        for (;;) {
          if (ready()) return;
          if (Date.now() > deadline) throw new Error("timeout waiting for " + label);
          await delay(20);
        }
      }

      export default async function () {
        const term = new FakeTerminal();
        const tui = new TUI(term);
        let result;
        try {
          await ensureTheme();
          const commands = new Map();
          piView({
            registerCommand: (name, spec) => commands.set(name, spec),
            registerShortcut: () => {},
            appendEntry: () => {},
            on: () => {},
          });
          const ctx = {
            cwd: process.cwd(),
            hasUI: true,
            ui: {
              notify: () => {},
              // Mirror OMP v18.2 showHookCustom: showOverlay captures the owned
              // handle, onHandle delivers it to the extension, and done() hides
              // through that handle — never a top-of-stack hideOverlay pop.
              custom: (factory, options) => {
                const { promise, resolve } = Promise.withResolvers();
                let handle;
                const done = () => { handle?.hide(); resolve(undefined); };
                const component = factory(tui, theme, {}, done);
                handle = tui.showOverlay(component, options?.overlayOptions);
                options?.onHandle?.(handle);
                return promise;
              },
            },
          };
          tui.start();
          const open = commands.get("view").handler(FIXTURE_PATH, ctx);
          await waitFor("preview body", () => term.joined().includes("SCRL0000"));
          assert.doesNotMatch(term.joined(), /SCRL0040/, "scroll target must start outside the viewport");
          const writesBeforeWheel = term.writes.length;
          for (let i = 0; i < 12; i++) term.wheel();
          assert.equal(term.historyScrolled, 0, "wheel must reach the preview, not scroll terminal history");
          assert.ok(term.modes.has(1049), "preview must isolate the transcript in the alternate buffer");
          await waitFor("wheel to reveal SCRL0040", () => term.writes.slice(writesBeforeWheel).join("").includes("SCRL0040"));
          term.key("\x1b");
          await open;
          assert.equal(tui.hasOverlay(), false, "closing must leave no overlay mounted");
          assert.equal(tui.getFocused(), null, "closing must leave no focused overlay");
          await waitFor("normal buffer and mouse restoration", () =>
            [1000, 1002, 1003, 1006, 1049].every(mode => !term.modes.has(mode)));
          result = { ok: true };
        } catch (error) {
          result = { ok: false, error: error.stack ?? String(error) };
        } finally {
          try { tui.stop(); } catch {}
        }
        writeFileSync(RESULT_PATH, JSON.stringify(result));
      }`, resolveDir: root, loader: "ts" },
    outfile: entryPath, bundle: true, platform: "node", format: "esm", external: ["@earendil-works/*"],
  });
  child = spawn(omp, ["--mode", "rpc", "--no-session", "--no-extensions", "-e", entryPath,
    "--no-skills", "--no-rules", "--no-tools", "--no-lsp", "--no-title", "--model", "anthropic/claude-sonnet-4-6"], {
    cwd: dir, stdio: "ignore", env: {
      ...process.env, PI_CODING_AGENT_DIR: join(dir, "profile"), OMP_PROFILE: "",
      ANTHROPIC_API_KEY: "pi-view-local-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      TERM_PROGRAM: "ghostty", TERM: "xterm-ghostty", PI_FORCE_IMAGE_PROTOCOL: "kitty", PI_VIEW_IMAGES: "auto",
      TMUX: "", STY: "", ZELLIJ: "",
    },
  });
  let result: ProbeResult | undefined;
  // The compiled host returns its probe result through a file.
  for (let i = 0; i < 1500; i++) {
    try { result = JSON.parse(await readFile(resultPath, "utf8")) as ProbeResult; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (child.exitCode !== null) assert.fail(`OMP exited before the scroll probe: ${child.exitCode}`);
    await delay(20);
  }
  assert.ok(result, "OMP did not complete the scroll probe");
  assert.equal(result.ok, true, result.error);
});
