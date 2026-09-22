import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { NvimEditor, type SpawnFn } from "../src/nvim.ts";

// Process-failure coverage for the embedded editor, through the same spawn
// seam production hands Neovim's argv to: one genuinely missing executable
// and one real subprocess that dies during startup. Everything
// protocol-level is exercised against genuine Neovim in
// nvim-integration.test.ts and test/omp-nvim.test.ts.

interface Recorder {
  ready: number;
  errors: string[];
  exits: { reason: "quit" | "crashed"; detail?: string }[];
  dirtyStates: boolean[];
}

function startEditor(dir: string, spawnChild: SpawnFn): { editor: NvimEditor; record: Recorder } {
  const record: Recorder = { ready: 0, errors: [], exits: [], dirtyStates: [] };
  const editor = new NvimEditor(join(dir, "doc.txt"), {
    cols: 40,
    rows: 10,
    onReady: () => { record.ready++; },
    onFlush: () => {},
    onError: message => { record.errors.push(message); },
    onExit: (reason, detail) => { record.exits.push({ reason, detail }); },
    onDirty: dirty => { record.dirtyStates.push(dirty); },
  }, spawnChild);
  editor.start();
  return { editor, record };
}

async function until(predicate: () => boolean, message: string, budget = 5_000): Promise<void> {
  const deadline = Date.now() + budget;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}

test("a missing Neovim executable surfaces an actionable error, not an exit", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-nvim-editor-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const absentBinary = join(dir, "no-such-nvim");
  const { editor, record } = startEditor(dir, (_command, args, options) => spawn(absentBinary, args, options));
  await until(() => record.errors.length > 0, "the spawn failure reaches onError");
  assert.equal(record.errors.length, 1, "one failure, reported once");
  assert.match(record.errors[0]!, /Neovim/, `the failure names the editor: ${record.errors[0]}`);
  assert.equal(record.exits.length, 0, "a spawn failure is not a user quit");
  assert.equal(record.ready, 0, "the session never became interactive");
  assert.equal(editor.running, false, "the dead session closed so the preview can recover");
});

test("a child dying during startup reports the exit code with its stderr context", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-nvim-editor-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const marker = "PI-VIEW-STARTUP-DIAGNOSTIC-91";
  const { editor, record } = startEditor(dir, (_command, args, options) =>
    spawn(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(marker + "\n")}); process.exit(7)`], options));
  await until(() => record.errors.length > 0, "the startup exit reaches onError");
  assert.equal(record.errors.length, 1, "one failure, reported once");
  assert.ok(record.errors[0]!.includes("code 7"), `the exit code surfaces: ${record.errors[0]}`);
  assert.ok(record.errors[0]!.includes(marker), `stderr diagnostics ride along: ${record.errors[0]}`);
  assert.equal(record.exits.length, 0, "a startup death is not a user quit");
  assert.equal(record.ready, 0, "the session never became interactive");
  assert.equal(editor.running, false, "the dead session closed so the preview can recover");
});
