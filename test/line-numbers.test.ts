import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { TUI, TuiInputListener } from "@earendil-works/pi-tui";
import { PreviewViewer } from "../src/viewer.ts";
import { attachMouse } from "../src/host.ts";
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

function makeViewer(t: { after(fn: () => void | Promise<void>): void }, path: string): { viewer: PreviewViewer; listeners: Set<TuiInputListener> } {
  const listeners = new Set<TuiInputListener>();
  const terminal = { rows: 18, columns: 72, write: () => {} };
  const tui = {
    terminal, mode: "regular", requestRender() {},
    addInputListener(listener: TuiInputListener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as unknown as TUI;
  const viewer = new PreviewViewer(tui, theme, () => {}, path);
  viewer.focused = true;
  t.after(() => viewer.dispose());
  return { viewer, listeners };
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

function feed(listeners: Set<TuiInputListener>, data: string): void {
  for (const listener of [...listeners]) listener(data);
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

test("Footer control reflects, toggles and persists numbering across fresh viewers", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "code.txt");
  await writeFile(path, "alpha\nbeta\ngamma\n");

  const first = makeViewer(t, path);
  const open = await screen(first.viewer, value => value.includes("alpha"));
  assert.match(open, /\[l Lines: off\]/);
  assert.doesNotMatch(open, /1 │ alpha/);

  first.viewer.handleInput("l");
  assert.match(await screen(first.viewer, value => value.includes("1 │ alpha")), /\[l Lines: on\]/);
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), true);

  const second = makeViewer(t, path);
  const reopened = await screen(second.viewer, value => value.includes("1 │ alpha"));
  assert.match(reopened, /\[l Lines: on\]/, "a fresh instance honors the persisted value");

  second.viewer.handleInput("l");
  assert.match(await screen(second.viewer, value => !value.includes("1 │ alpha")), /\[l Lines: off\]/);
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
  assert.match(rendered, /Lines: s source/, "source numbering availability is visible");

  viewer.handleInput("s");
  const source = await screen(viewer, value => value.includes("# Heading"));
  assert.match(source, /1 │ # Heading/);
  assert.match(source, /\[l Lines: on\]/);
  viewer.handleInput("/"); viewer.handleInput("H"); viewer.handleInput("e"); viewer.handleInput("a"); viewer.handleInput("\r");
  // Match navigation lives in the title, which the truncated tmpdir path can
  // crowd out at body width; the suite convention reads titles wide.
  assert.match(stripVTControlCharacters(viewer.render(160)[0]), /match 1\b/, "search keeps working while numbers are shown");

  viewer.handleInput("r");
  await screen(viewer, value => value.includes("1 │ # Heading"));
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /\[l Lines: on\]/, "reload keeps the preference");

  viewer.handleInput("o");
  const picker = await screen(viewer, value => value.includes("note.md"));
  assert.doesNotMatch(picker, /\[l Lines:/, "the directory picker has no numbering control");
  viewer.handleInput("\r");
  await screen(viewer, value => value.includes("Heading"));
  viewer.handleInput("s");
  const navigated = await screen(viewer, value => value.includes("1 │ # Heading"));
  assert.match(navigated, /\[l Lines: on\]/, "navigation preserves the persisted value");
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
  assert.doesNotMatch(help, /\[l Lines:/, "help has no numbering control");
  for (let page = 0; page < 3; page++) {
    viewer.handleInput("\x1b[6~"); // page down through every help viewport
    help = stripVTControlCharacters(viewer.render(72).join("\n"));
    assert.doesNotMatch(help, /│/, "every help viewport stays gutter-free");
    assert.doesNotMatch(help, /\[l Lines:/);
  }
  viewer.handleInput("b");
  const listing = await screen(viewer, value => value.includes("entry.txt"));
  assert.doesNotMatch(listing, /1 │ entry\.txt/);
});

test("Clicking the footer Lines control toggles numbering like the l key", async t => {
  const file = await isolateState(t);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-lines-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "code.txt");
  await writeFile(path, "alpha\nbeta\n");
  const { viewer, listeners } = makeViewer(t, path);
  await screen(viewer, value => value.includes("alpha"));

  // rows=18 → body height 13, so the status row is 16 (0-based); the chip starts at column 0.
  feed(listeners, "\x1b[<0;5;17M"); // press inside the chip: col 4, row 16
  assert.match(await screen(viewer, value => value.includes("1 │ alpha")), /\[l Lines: on\]/);
  feed(listeners, "\x1b[<0;5;17m"); // release alone never toggles
  feed(listeners, "\x1b[<0;5;2M"); // press on a body row
  feed(listeners, "\x1b[<0;40;17M"); // press past the chip
  assert.doesNotMatch(stripVTControlCharacters(viewer.render(72).join("\n")), /\[l Lines: off\]/);
  flushLineNumbersSave();
  assert.equal(readLineNumbers(file), true, "a footer click persists like the keyboard toggle");
});

test("attachMouse reports primary presses as clicks and keeps wheel working", () => {
  const clicks: Array<[number, number]> = [];
  const wheels: number[] = [];
  const listeners: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
  const written: string[] = [];
  const tui = { terminal: { rows: 24, columns: 80, write: (data: string) => written.push(data) }, addInputListener(listener: (data: string) => { consume?: boolean; data?: string } | undefined) { listeners.push(listener); return () => {}; } } as unknown as TUI;
  const detach = attachMouse(tui, delta => wheels.push(delta), (column, row) => clicks.push([column, row]));
  const feed = (data: string): boolean => {
    let result: { consume?: boolean; data?: string } | undefined;
    for (const listener of [...listeners]) {
      result = listener(data);
      if (result?.consume) return true;
      if (result?.data !== undefined) data = result.data;
    }
    return false;
  };

  assert.deepEqual(feed("\x1b[<0;3;17M"), true);
  assert.deepEqual(clicks.at(-1), [2, 16], "SGR press arrives 1-based and lands 0-based");
  assert.deepEqual(feed("\x1b[<0;3;17m"), true);
  assert.equal(clicks.length, 1, "release is not a click");
  assert.equal(feed("\x1b[<32;3;17M"), true, "motion tracking is consumed");
  assert.equal(clicks.length, 1);
  assert.equal(feed("\x1b[<2;3;17M"), true, "other buttons are consumed");
  assert.equal(clicks.length, 1);
  assert.equal(feed("\x1b[M #3"), true);
  assert.deepEqual(clicks.at(-1), [2, 18], "X10 press decodes to 0-based cells");
  assert.equal(feed("\x1b[32;10;20M"), true);
  assert.deepEqual(clicks.at(-1), [9, 19], "urxvt press decodes to 0-based cells");
  assert.equal(feed("\x1b[<64;1;1M"), true);
  assert.deepEqual(wheels, [-3], "wheel routing is unchanged");
  detach();
  assert.ok(written.length > 0, "mode probes go to the provided terminal, never real stdout");
});
