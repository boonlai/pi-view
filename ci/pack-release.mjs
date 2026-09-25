import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const allowed = ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/image-worker.mjs"].sort();
const output = join(process.env.RUNNER_TEMP ?? tmpdir(), "pi-view-release");
mkdirSync(output);
const consumer = mkdtempSync(join(tmpdir(), "pi-view-consumer-"));
let succeeded = false;
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", output], { encoding: "utf8" }));
  assert.equal(packed.length, 1);
  const { filename, name, version, files } = packed[0];
  assert.equal(name, pkg.name);
  assert.equal(version, pkg.version);
  assert.equal(filename, `${name}-${version}.tgz`);
  assert.deepEqual(files.map(file => file.path).sort(), allowed, "npm package contains unexpected or missing files");
  const archive = join(output, filename);
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(entries.map(entry => {
    assert.ok(entry.startsWith("package/"), `unexpected archive entry: ${entry}`);
    return entry.slice("package/".length);
  }).sort(), allowed, "archive contents differ from the allowed files");

  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", archive], { cwd: consumer, stdio: "pipe" });
  const worker = join(consumer, "node_modules", pkg.name, "dist", "image-worker.mjs");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>';
  const request = { id: 1, operation: "decode", label: "installed package", data: Buffer.from(svg).toString("base64") };
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [worker], {
    cwd: consumer, env, input: `${JSON.stringify(request)}\n`, encoding: "utf8", timeout: 20_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.id, request.id);
  assert.equal(response.error, undefined);
  assert.equal(response.label, request.label);
  assert.equal(response.width, 2);
  assert.equal(response.height, 3);
  const png = Buffer.from(response.data, "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 3);

  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(join(output, `${filename}.sha256`), `${checksum}  ${basename(archive)}\n`);
  console.log(`Packed and installed ${filename}; distributed image worker decoded a 2x3 PNG.`);
  succeeded = true;
} finally {
  rmSync(consumer, { recursive: true, force: true });
  if (!succeeded) rmSync(output, { recursive: true, force: true });
}
