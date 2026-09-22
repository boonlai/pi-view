import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { TUI } from "@earendil-works/pi-tui";
import { PreviewViewer } from "../src/viewer.ts";
import {
  flushLineNumbersSave, getStateFile, queueLineNumbersSave, readLineNumbers,
  resetStateFile, setStateFile, writeLineNumbers,
} from "../src/settings.ts";

initTheme("dark", false);
const theme = getThemeByName("dark")!;

/** Isolate the preference file for one test and restore the real location after. */
async function isolateState(t: { after(fn: () => void | Promise<void>): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  const file = join(dir, "settings.json");
  setStateFile(file);
  t.after(async () => {
    resetStateFile();
    await rm(dir, { recursive: true, force: true });
  });
  return file;
}

function makeViewer(t: { after(fn: () => void | Promise<void>): void }, path: string): { viewer: PreviewViewer } {
  const terminal = { rows: 18, columns: 72, write: () => {} };
  const tui = {
    terminal, mode: "regular", requestRender() {},
    addInputListener() { return () => {}; },
  } as unknown as TUI;
  const viewer = new PreviewViewer(tui, theme, () => {}, path);
  viewer.focused = true;
  t.after(() => viewer.dispose());
  return { viewer };
}

async function screen(viewer: PreviewViewer, predicate: (text: string) => boolean): Promise<string> {
  let text = "";
  for (let i = 0; i < 150; i++) {
    text = stripVTControlCharacters(viewer.render(72).join("\n"));
    if (predicate(text)) return text;
    await delay(20);
  }
  assert.fail(`Viewer never reached expected screen:\n${text}`);
}

test("Preference file round-trips both values and rejects malformed state", async t => {
  const file = await isolateState(t);
  assert.equal(getStateFile(), file);
  assert.equal(readLineNumbers(file), false, "missing file means the default (off)");
  writeLineNumbers(file, true);
  assert.equal(readLineNumbers(file), true);
  writeLineNumbers(file, false);
  assert.equal(readLineNumbers(file), false, "off is persisted, not deleted");
  for (const broken of ["not json", '{"lineNumbers":"yes"}', '{"lineNumbers":0}', "[]"]) {
    await writeFile(file, broken);
    assert.equal(readLineNumbers(file), false, `malformed state falls back to off: ${broken}`);
  }
  await writeFile(file, '{"lineNumbers":true}');
  assert.equal(readLineNumbers(file), true);
});

test("Read failures fall back to the default without throwing", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(readLineNumbers(join(dir, "missing", "settings.json")), false);
  assert.equal(readLineNumbers(dir), false, "a directory in place of the file reads as off");
});

test("Queued saves coalesce, flush once and swallow write failures", async t => {
  const file = await isolateState(t);
  queueLineNumbersSave(true);
  queueLineNumbersSave(false);
  queueLineNumbersSave(true);
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), true);
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), true, "idle flush is a no-op");

  // A path that cannot become the settings file must not surface an error.
  const blocked = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(blocked, { recursive: true, force: true }));
  setStateFile(blocked);
  queueLineNumbersSave(false);
  flushLineNumbersSave();
  setStateFile(file);
  assert.equal(readLineNumbers(file), true, "failed writes leave the last good state");
});

test("The l key toggles and persists numbering across fresh viewers", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "code.txt");
  await writeFile(path, "alpha\nbeta\ngamma\n");

  const first = makeViewer(t, path);
  const open = await screen(first.viewer, value => value.includes("alpha"));
  assert.doesNotMatch(open, /1 │ alpha/);

  first.viewer.handleInput("l");
  await screen(first.viewer, value => value.includes("1 │ alpha"));
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), true);

  const second = makeViewer(t, path);
  await screen(second.viewer, value => value.includes("1 │ alpha"));

  second.viewer.handleInput("l");
  await screen(second.viewer, value => value.includes("alpha") && !value.includes("1 │ alpha"));
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), false);
});

test("Numbers survive reload and navigation and apply only to source rows", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "note.md"), "# Heading\n\nBody text\n");
  writeLineNumbers(file, true);

  const { viewer } = makeViewer(t, join(dir, "note.md"));
  const rendered = await screen(viewer, value => value.includes("Heading"));
  assert.doesNotMatch(rendered, /1 │/, "rendered Markdown keeps its semantics: no source numbers");

  viewer.handleInput("s");
  const source = await screen(viewer, value => value.includes("# Heading"));
  assert.match(source, /1 │ # Heading/);
  viewer.handleInput("/"); viewer.handleInput("H"); viewer.handleInput("e"); viewer.handleInput("a"); viewer.handleInput("\r");
  // Match navigation lives in the title, which the truncated tmpdir path can
  // crowd out at body width; the suite convention reads titles wide.
  assert.match(stripVTControlCharacters(viewer.render(160)[0]), /match 1\b/, "search keeps working while numbers are shown");

  viewer.handleInput("r");
  await screen(viewer, value => value.includes("1 │ # Heading"));

  viewer.handleInput("o");
  await screen(viewer, value => value.includes("note.md"));
  viewer.handleInput("\r");
  await screen(viewer, value => value.includes("Heading"));
  viewer.handleInput("s");
  await screen(viewer, value => value.includes("1 │ # Heading"));
});

test("Help and directory views never gain meaningless gutters", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "entry.txt"), "content");
  writeLineNumbers(file, true);

  const { viewer } = makeViewer(t, dir);
  await screen(viewer, value => value.includes("entry.txt"));
  viewer.handleInput("?");
  // The panel replaces the path title with "pi-view"; help wording is not pinned.
  let help = await screen(viewer, value => value.startsWith("pi-view"));
  assert.doesNotMatch(help, /│/, "help stays gutter-free even with numbering remembered on");
  for (let page = 0; page < 3; page++) {
    viewer.handleInput("\x1b[6~"); // page down through every help viewport
    help = stripVTControlCharacters(viewer.render(72).join("\n"));
    assert.doesNotMatch(help, /│/, "every help viewport stays gutter-free");
  }
  viewer.handleInput("b");
  const listing = await screen(viewer, value => value.includes("entry.txt"));
  assert.doesNotMatch(listing, /1 │ entry\.txt/);
});

test("Numbering stays limited to source rows when focusing images", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "note.md"), "# Heading\n\n![pic](pic.png)\n");
  writeLineNumbers(file, true);
  const previousImages = process.env.PI_VIEW_IMAGES;
  process.env.PI_VIEW_IMAGES = "off";
  t.after(() => {
    if (previousImages === undefined) delete process.env.PI_VIEW_IMAGES; else process.env.PI_VIEW_IMAGES = previousImages;
  });

  const { viewer } = makeViewer(t, join(dir, "note.md"));
  const rendered = await screen(viewer, value => value.includes("pic.png"));
  assert.doesNotMatch(rendered, /1 │/, "rendered Markdown keeps its semantics");
  viewer.handleInput("i");
  const focused = stripVTControlCharacters(viewer.render(72).join("\n"));
  assert.match(focused, /zoom/, "image controls take over the footer");
  viewer.handleInput("b");
  await screen(viewer, value => value.includes("pic.png"));
  viewer.handleInput("s");
  viewer.handleInput("i"); // batched right after s: stale image focus must not apply
  const source = await screen(viewer, value => value.includes("![pic](pic.png)"));
  assert.match(source, /1 │ # Heading/, "the source view keeps its numbering");
  assert.doesNotMatch(source, /zoom/, "stale image focus cannot hijack the source view");
});
