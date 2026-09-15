import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { build } from "esbuild";
import sharp from "sharp";

test("OMP preview owns its transmitted image and deletes only that image on dismissal", { timeout: 30_000 }, async t => {
  const omp = process.env.PI_VIEW_OMP || "omp";
  const installed = spawnSync(omp, ["--version"], { encoding: "utf8", timeout: 5000 });
  if ((installed.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") { t.skip("OMP is not installed"); return; }
  assert.equal(installed.status, 0, installed.stderr);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-omp-image-"));
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
  const entryPath = join(dir, "probe.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const png = await sharp({ create: { width: 36, height: 36, channels: 3, background: "red" } }).png().toBuffer();
  await build({
    stdin: { contents: `
      import { writeFileSync } from "node:fs";
      import { createTerminalImage } from ${JSON.stringify(join(root, "src/host.ts"))};
      export default function () {
        const writes = [];
        const tui = { terminal: { write: value => writes.push(value) } };
        const png = Buffer.from(${JSON.stringify(png.toString("base64"))}, "base64");
        const unrelated = createTerminalImage(png, 4, 2, "conversation.png", tui);
        const preview = createTerminalImage(png, 4, 2, "preview.png", tui);
        const unrelatedLines = unrelated.render(6);
        const lines = preview.render(6);
        preview.invalidate();
        const repainted = preview.render(6);
        preview.dispose();
        preview.dispose();
        writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
          previewId: preview.imageId, unrelatedId: unrelated.imageId,
          unrelatedLines, lines, repainted, writes, afterClose: preview.render(6)
        }));
        unrelated.dispose();
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
  let result: { previewId: number; unrelatedId: number; lines: string[]; repainted: string[]; writes: string[]; afterClose: string[] } | undefined;
  for (let i = 0; i < 500; i++) {
    try { result = JSON.parse(await readFile(resultPath, "utf8")); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (child.exitCode !== null) assert.fail(`OMP exited before the image probe: ${child.exitCode}`);
    await delay(20);
  }
  assert.ok(result, "OMP did not complete the image probe");
  assert.ok(Number.isInteger(result.previewId) && result.previewId > 0 && result.previewId <= 0xffffffff);
  assert.notEqual(result.previewId, result.unrelatedId);
  for (const lines of [result.lines, result.repainted]) {
    const header = [...lines.join("").matchAll(/\x1b_G([^;]*);/g)]
      .map(match => match[1]).find(value => value.split(",").includes("a=T"));
    assert.ok(header, "native OMP output must contain a Kitty transmit-and-display command");
    assert.match(header, new RegExp(`(?:^|,)i=${result.previewId}(?:,|$)`));
  }
  const deleted = [...result.writes.join("").matchAll(/\x1b_G([^;]*?)\x1b\\/g)].map(match => match[1]);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], new RegExp(`(?:^|,)i=${result.previewId}(?:,|$)`));
  assert.match(deleted[0], /(?:^|,)d=I(?:,|$)/);
  assert.doesNotMatch(deleted[0], /(?:^|,)d=[aA](?:,|$)/);
  assert.deepEqual(result.afterClose, []);
});
