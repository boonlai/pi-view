import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { build } from "esbuild";

interface ProbeResult { ok: boolean; error?: string }

// Runs the genuine edit cycle — open, e, type, :w, :q — with a real Neovim
// child inside the compiled OMP host (Bun runtime, bundled codec, aliased
// pi-tui). This is the boundary Node-side tests cannot cover. Readiness
// gates on rendered editor content (grid text, disk bytes, terminal frame
// shape), never on title prose: the window title carries a long absolute
// path and truncates at realistic widths.
test("OMP runtime edits a real file through embedded Neovim and saves it", { timeout: 120_000 }, async t => {
  const omp = process.env.PI_VIEW_OMP || "omp";
  const installed = spawnSync(omp, ["--version"], { encoding: "utf8", timeout: 5000 });
  if ((installed.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") { t.skip("OMP is not installed"); return; }
  assert.equal(installed.status, 0, installed.stderr);
  const nvimCheck = spawnSync("nvim", ["--version"], { encoding: "utf8", timeout: 5000 });
  if ((nvimCheck.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") { t.skip("nvim is not installed"); return; }
  assert.equal(nvimCheck.status, 0, nvimCheck.stderr);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-omp-nvim-"));
  let child: ChildProcess | undefined;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = Promise.withResolvers<void>();
      child.kill("SIGKILL");
      child.once("exit", exited.resolve);
      await exited.promise;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const resultPath = join(dir, "result.json");
  const fixturePath = join(dir, "fixture.txt");
  await writeFile(fixturePath, "original markdown line\n");
  const entryPath = join(dir, "probe.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  await build({
    stdin: { contents: String.raw`
      import { writeFileSync } from "node:fs";
      import { readFile } from "node:fs/promises";
      import assert from "node:assert/strict";
      import { setTimeout as delay } from "node:timers/promises";
      import { CURSOR_MARKER, TUI } from "@earendil-works/pi-tui";
      import { ensureTheme, theme } from "@earendil-works/pi-coding-agent";
      import piView from ${JSON.stringify(join(root, "src/index.ts"))};

      const RESULT_PATH = ${JSON.stringify(resultPath)};
      const FIXTURE_PATH = ${JSON.stringify(fixturePath)};

      class FakeTerminal {
        constructor() {
          this.writes = [];
          this.onInput = undefined;
        }
        start(onInput) { this.onInput = onInput; }
        stop() {}
        async drainInput() {}
        write(data) { this.writes.push(data); }
        get columns() { return 90; }
        get rows() { return 26; }
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
        recent() { return this.writes.slice(-40).join(""); }
        key(data) { this.onInput(data); }
      }


      export default async function () {
        const term = new FakeTerminal();
        const tui = new TUI(term);

        async function waitFor(label, ready, budget = 20000) {
          const deadline = Date.now() + budget;
          for (;;) {
            if (await ready()) return;
            if (Date.now() > deadline) throw new Error("timeout waiting for " + label
              + "; recent=" + JSON.stringify(term.recent().split(CURSOR_MARKER).join("").slice(-600)));
            await delay(20);
          }
        }

        let result;
        let surface;
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
              custom: (factory, options) => {
                const { promise, resolve } = Promise.withResolvers();
                let handle;
                const done = () => { handle?.hide(); resolve(undefined); };
                const component = factory(tui, theme, {}, done);
                surface = component;
                handle = tui.showOverlay(component, options?.overlayOptions);
                options?.onHandle?.(handle);
                return promise;
              },
            },
          };
          tui.start();
          const open = commands.get("view").handler(FIXTURE_PATH, ctx);
          await waitFor("preview body", () => term.joined().includes("original markdown line"));
          assert.ok(term.joined().includes("e: edit"), "eligible preview advertises the edit action");
          term.key("e");
          // The embedded grid arrives through the bundled msgpack codec under Bun.
          await waitFor("embedded Neovim grid", () => term.joined().includes(":w save"));
          term.key("AOMP-EDITED-7391");
          term.key("\x1b");
          // Dirty state shows in the editor's own content: the typed text is
          // on screen. The title would truncate long paths before "[+]"/
          // "modified" could ever render.
          await waitFor("inserted text visible in the editor grid", () =>
            term.joined().split(CURSOR_MARKER).join("").includes("OMP-EDITED-7391"));
          term.key(":");
          term.key("w");
          term.key("\r");
          await waitFor(":w to persist", async () => (await readFile(FIXTURE_PATH, "utf8")).includes("OMP-EDITED-7391"));
          term.key(":");
          term.key("q");
          term.key("\r");
          // Terminal writes are incremental and may omit an unchanged body.
          // Read the component's complete public render, not a raw write chunk.
          await waitFor("editor exit restores the refreshed preview", () => {
            const frame = surface.render(term.columns).join("\n").split(CURSOR_MARKER).join("");
            return !surface.editing && frame.includes("OMP-EDITED-7391");
          });
          term.key("\x1b");
          await open;
          assert.equal(tui.hasOverlay(), false, "closing must leave no overlay mounted");
          result = { ok: true };
        } catch (error) {
          result = { ok: false, error: error.stack ?? String(error) };
        } finally {
          try { surface?.dispose(); } catch {}
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
      // The embedded Neovim child inherits this environment: keep its state
      // (swap files, shada) inside the temp dir this test owns and removes.
      HOME: join(dir, "home"), USERPROFILE: join(dir, "home"),
      XDG_CONFIG_HOME: join(dir, "xdg-config"), XDG_CACHE_HOME: join(dir, "xdg-cache"),
      XDG_DATA_HOME: join(dir, "xdg-data"), XDG_STATE_HOME: join(dir, "xdg-state"),
      ANTHROPIC_API_KEY: "pi-view-local-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      TERM_PROGRAM: "ghostty", TERM: "xterm-ghostty", PI_FORCE_IMAGE_PROTOCOL: "kitty", PI_VIEW_IMAGES: "off",
      TMUX: "", STY: "", ZELLIJ: "",
    },
  });
  let result: ProbeResult | undefined;
  // The compiled host returns its probe result through a file.
  for (let i = 0; i < 3000; i++) {
    try { result = JSON.parse(await readFile(resultPath, "utf8")) as ProbeResult; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (child.exitCode !== null) assert.fail(`OMP exited before the nvim probe: ${child.exitCode}`);
    await delay(20);
  }
  assert.ok(result, "OMP did not complete the nvim probe");
  assert.equal(result.ok, true, result.error);
});
