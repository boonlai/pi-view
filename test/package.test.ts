import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("distributed image worker runs under node_modules with plain Node", { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-package-"));
  let child: ChildProcess | undefined;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close"); child.kill("SIGKILL"); await closed;
    }
    await rm(dir, { recursive: true, force: true });
  });
  const installed = join(dir, "node_modules", "pi-view");
  await mkdir(installed, { recursive: true });
  await cp(new URL("../dist/", import.meta.url), join(installed, "dist"), { recursive: true });
  await cp(new URL("../package.json", import.meta.url), join(installed, "package.json"));
  await symlink(fileURLToPath(new URL("../node_modules/sharp", import.meta.url)), join(dir, "node_modules", "sharp"), "junction");
  child = spawn(process.execPath, [join(installed, "dist", "image-worker.mjs")], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" },
  });
  let stdout = "", stderr = "";
  child.stdout!.on("data", data => { stdout += data; });
  child.stderr!.on("data", data => { stderr += data; });
  child.stdin!.on("error", () => {}); // A failed module import can close stdin before the request is written.
  const closed = once(child, "close");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>';
  child.stdin!.end(JSON.stringify({ id: 1, operation: "decode", data: Buffer.from(svg).toString("base64"), label: "installed package" }) + "\n");
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  const image = JSON.parse(stdout);
  assert.equal(image.width, 2, image.error);
  assert.equal(image.height, 3);
  assert.deepEqual(Buffer.from(image.data, "base64").subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});
