import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { visibleWidth, type TUI, type TuiInputListener } from "@earendil-works/pi-tui";
import { PreviewViewer } from "../src/viewer.ts";

initTheme("dark", false);
const theme = getThemeByName("dark")!;

async function setup(t: { after(fn: () => void | Promise<void>): void }, filename?: string, content?: string) {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-ui-test-"));
  const previous = process.env.PI_VIEW_IMAGES;
  process.env.PI_VIEW_IMAGES = "off";
  const listeners = new Set<TuiInputListener>();
  const writes: string[] = [];
  const terminal = { rows: 18, columns: 72, write: (data: string) => writes.push(data) };
  const tui = {
    terminal, mode: "regular", requestRender() {},
    addInputListener(listener: TuiInputListener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as unknown as TUI;
  const path = filename ? join(dir, filename) : dir;
  if (filename) await writeFile(path, content ?? "");
  let closes = 0;
  const viewer = new PreviewViewer(tui, theme, () => { closes++; }, path);
  viewer.focused = true;
  t.after(async () => {
    viewer.dispose();
    if (previous === undefined) delete process.env.PI_VIEW_IMAGES; else process.env.PI_VIEW_IMAGES = previous;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, path, viewer, terminal, listeners, writes, closes: () => closes };
}

async function screen(viewer: PreviewViewer, predicate: (text: string) => boolean, width = 72): Promise<string> {
  let text = "";
  for (let i = 0; i < 150; i++) {
    text = stripVTControlCharacters(viewer.render(width).join("\n"));
    if (predicate(text)) return text;
    await delay(20);
  }
  assert.fail(`Viewer never reached expected screen:\n${text}`);
}

function type(viewer: PreviewViewer, value: string): void {
  for (const char of value) viewer.handleInput(char);
  viewer.handleInput("\r");
}

test("Viewer scrolls, searches, toggles line numbers, reloads changes and closes cleanly", async t => {
  const { viewer, path, listeners, closes } = await setup(t, "code.ts", Array.from({ length: 90 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n"));
  await screen(viewer, value => value.includes("const line1"));
  viewer.handleInput("\x1b[6~");
  assert.match(await screen(viewer, value => value.includes("const line14")), /const line14/);
  viewer.handleInput("/"); type(viewer, "line70");
  assert.match(await screen(viewer, value => value.includes("const line70")), /const line70/);
  viewer.handleInput("\x1b[108;1u");
  viewer.handleInput("\x1b[108;1:3u"); // key release must not toggle twice
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /70 │/);
  await writeFile(path, "const updated = true;\n");
  assert.match(await screen(viewer, value => value.includes("updated")), /updated/);
  viewer.handleInput("\x1b");
  assert.equal(closes(), 1);
  assert.equal(listeners.size, 0);
  viewer.dispose();
});

test("Markdown fallback remains scrollable and source view preserves image markup", async t => {
  const { viewer } = await setup(t, "readme.md", "# Heading\n\nText before\n\n![example](missing.png)\n\nText after\n");
  await screen(viewer, value => value.includes("[missing.png]"));
  viewer.handleInput("s");
  const source = await screen(viewer, value => value.includes("![example](missing.png)"));
  assert.match(source, /# Heading/);
  for (const width of [1, 8, 40, 72]) {
    for (const line of viewer.render(width)) assert.ok(visibleWidth(line) <= width, `overflow at ${width}: ${line}`);
  }
});

test("No-path picker filters names with spaces and opens selected files", async t => {
  const { viewer, dir } = await setup(t);
  const name = "file with spaces.txt";
  await writeFile(join(dir, name), "picked content");
  viewer.handleInput("r");
  await screen(viewer, value => value.includes(name));
  viewer.handleInput("/"); type(viewer, "with spaces");
  viewer.handleInput("\r");
  await screen(viewer, value => value.includes("picked content"));
  viewer.handleInput("o");
  await screen(viewer, value => value.includes(name));
  for (const line of viewer.render(8)) assert.ok(visibleWidth(line) <= 8);
});

test("Search advances through multiple matches in the final viewport", async t => {
  const { viewer } = await setup(t, "short.txt", Array.from({ length: 20 }, (_, i) => i >= 18 ? "needle" : `row ${i}`).join("\n"));
  await screen(viewer, value => value.includes("row 0"));
  viewer.handleInput("/"); type(viewer, "needle");
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 19/);
  viewer.handleInput("n");
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 20/);
  viewer.handleInput("n");
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 19/);
});

test("A pending file reload cannot reopen a file after navigating away", async t => {
  const { viewer, path, dir } = await setup(t, "a.txt", "original");
  await writeFile(join(dir, "b.txt"), "other document");
  await screen(viewer, value => value.includes("original"));
  await writeFile(path, "changed");
  await delay(40);
  viewer.handleInput("o");
  await screen(viewer, value => value.includes("b.txt"));
  viewer.handleInput("/"); type(viewer, "b.txt"); viewer.handleInput("\r");
  await screen(viewer, value => value.includes("other document"));
  await delay(300);
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /other document/);
});

test("Failed reloads remain watched and large short-line files remain searchable", async t => {
  const { viewer, path } = await setup(t, "large.txt", "a\n".repeat(150_000) + "needle");
  await screen(viewer, value => !value.includes("Loading"));
  viewer.handleInput("/"); type(viewer, "needle");
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /needle/);
  await writeFile(path, Buffer.from([0]));
  await screen(viewer, value => value.includes("Binary file"));
  await writeFile(path, "recovered text");
  await screen(viewer, value => value.includes("recovered text"));
});

test("Search matches phrases across soft wraps", async t => {
  const { viewer } = await setup(t, "wrap.txt", "alpha beta gamma delta\nsecond row\n");
  await screen(viewer, value => value.includes("alpha beta"), 20);
  viewer.handleInput("/"); type(viewer, "gamma delta");
  const frame = stripVTControlCharacters(viewer.render(20).join("\n"));
  assert.doesNotMatch(frame, /No match/);
  assert.match(frame, /alpha beta gamma/);
  assert.match(frame, /\ndelta\n/);
  viewer.handleInput("n");
  assert.doesNotMatch(stripVTControlCharacters(viewer.render(20).join("\n")), /No match/);
});

test("Search reaches tail occurrences inside one long wrapped line", async t => {
  const { viewer } = await setup(t, "long.txt", `head needle ${"pad ".repeat(200)}needle tail\n`);
  await screen(viewer, value => value.includes("head"), 20);
  viewer.handleInput("/"); type(viewer, "needle");
  assert.match(stripVTControlCharacters(viewer.render(20).join("\n")), /head needle/);
  viewer.handleInput("n");
  const tail = stripVTControlCharacters(viewer.render(20).join("\n"));
  assert.match(tail, /needle\s+tail/);
  assert.doesNotMatch(tail, /head needle|No match/);
  viewer.handleInput("N");
  assert.match(stripVTControlCharacters(viewer.render(20).join("\n")), /head needle/);
});

test("Search crosses syntax-highlight colors without escape false hits", async t => {
  const { viewer } = await setup(t, "code.ts", "const fileName = computeName(file);\n");
  await screen(viewer, value => value.includes("computeName"));
  viewer.render(20); // narrow layout before querying
  viewer.handleInput("/");
  type(viewer, "const filename"); // spans differently-colored tokens
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 1/);
  assert.match(stripVTControlCharacters(viewer.render(20).join("\n")), /const/);
  viewer.handleInput("/");
  for (let i = 0; i < 16; i++) viewer.handleInput("\x7f");
  type(viewer, "m ="); // only exists inside highlighter escape sequences
  assert.match(stripVTControlCharacters(viewer.render(120).join("\n")), /No match: m =/);
});

test("Markdown wrap boundaries distinguish spaces from mid-word breaks", async t => {
  const { viewer } = await setup(t, "hello.md", "hello world\n\nsupercalifragilisticexpialidocious tail\n");
  await screen(viewer, value => value.includes("hello"), 5);
  viewer.handleInput("/"); type(viewer, "hello world");
  const greeting = stripVTControlCharacters(viewer.render(5).join("\n"));
  assert.match(greeting, /hello\nworld/);
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 1/);
  viewer.render(5);
  viewer.handleInput("/"); viewer.handleInput("\x15"); type(viewer, "helloworld");
  assert.match(stripVTControlCharacters(viewer.render(120).at(-1)!), /No match: helloworld/);
  viewer.render(5);
  viewer.handleInput("/"); viewer.handleInput("\x15"); type(viewer, "supercalifragilisticexpialidocious");
  const body = viewer.render(5).slice(2, -2).map(stripVTControlCharacters).join("");
  assert.match(body, /supercalifragilisticexpialidocious/);
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match \d/);
});

test("Long identifiers wrapped mid-word remain searchable with line numbers", async t => {
  const { viewer } = await setup(t, "ident.ts", "const supercalifragilisticexpialidocious = 1;\n");
  await screen(viewer, value => value.includes("supercalifragilistic"));
  viewer.handleInput("l");
  viewer.render(20);
  viewer.handleInput("/"); type(viewer, "supercalifragilisticexpialidocious");
  const frame = stripVTControlCharacters(viewer.render(20).join("\n"));
  assert.match(frame, /supercalifragili/);
  assert.match(frame, /us = 1;/);
  assert.doesNotMatch(frame, /No match/);
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 2/);
});

test("Raw keyboard input inserts international characters in search and filter", async t => {
  const { viewer, dir } = await setup(t, "ru.txt", "финал\n");
  await writeFile(join(dir, "файл.txt"), "второй");
  await screen(viewer, value => value.includes("финал"));
  viewer.handleInput("/");
  viewer.handleInput("\u001b[1092::97;1u"); // Cyrillic ф carrying a Latin base-layout key
  const status = stripVTControlCharacters(viewer.render(72).join("\n")).split("\n").at(-1) ?? "";
  assert.match(status, /search:.*ф/);
  assert.doesNotMatch(status, /search:.*\ba\b/); // base-layout 'a' must not leak into the query
  type(viewer, "инал");
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 1/);
  viewer.handleInput("o");
  await screen(viewer, value => value.includes("файл.txt"));
  viewer.handleInput("/");
  viewer.handleInput("\u001b[1092::97;1u");
  type(viewer, "айл");
  const filterTitle = stripVTControlCharacters(viewer.render(120)[0]);
  assert.match(filterTitle, /filter: файл/);
});

test("Help takes precedence over the hidden picker for wheel and slash", async t => {
  const { viewer, dir } = await setup(t);
  await writeFile(join(dir, "solo.txt"), "content");
  viewer.handleInput("r");
  await screen(viewer, value => value.includes("solo.txt"));
  viewer.handleInput("?");
  assert.match(await screen(viewer, value => value.includes("pi-view — local previews")), /pi-view · 1\//);
  viewer.wheel(3);
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /pi-view · 4\//);
  viewer.handleInput("/");
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")).split("\n").at(-1) ?? "", /^search: /);
  type(viewer, "Quick Open");
  assert.match(stripVTControlCharacters(viewer.render(72).join("\n")), /· match \d/);
  viewer.handleInput("b");
  const picker = await screen(viewer, value => value.includes("solo.txt"));
  assert.match(picker, /(^|\n)> solo\.txt/); // hidden selection never moved
  assert.ok(!picker.includes("· filter:"), "filter must stay empty while searching help");
});

test("Editing and retargeting a watched alias reloads its destination", async t => {
  const { viewer, dir, path } = await setup(t, "alias.txt", "placeholder");
  await rm(path);
  await mkdir(join(dir, "target"));
  const real = join(dir, "target", "real.txt");
  await writeFile(real, "target version");
  await symlink(real, path);
  viewer.handleInput("r");
  await screen(viewer, value => value.includes("target version"));
  await writeFile(real, "edited target"); // target lives in a separate directory
  await screen(viewer, value => value.includes("edited target"));
  const next = join(dir, "target", "next.txt");
  await writeFile(next, "replaced target");
  await rename(next, real); // atomic replacement of the target
  await screen(viewer, value => value.includes("replaced target"));
  const second = join(dir, "target", "second.txt");
  await writeFile(second, "second destination");
  await rm(path);
  await symlink(second, path); // retarget the alias
  await screen(viewer, value => value.includes("second destination"));
});


test("Search after Markdown images jumps to the actual later block", async t => {
  const source = `${Array.from({ length: 40 }, (_, i) => `before ${i}\n\n`).join("")}![image](missing.png)\n\nneedle destination\n\n${"after\n\n".repeat(20)}`;
  const { viewer } = await setup(t, "blocks.md", source);
  await screen(viewer, value => value.includes("before 0"));
  viewer.handleInput("/"); type(viewer, "needle");
  const frame = stripVTControlCharacters(viewer.render(72).join("\n"));
  assert.match(frame, /needle destination/);
  assert.doesNotMatch(frame, /before 0|No match/);
});

test("Case-insensitive search keeps original offsets after Unicode case expansion", async t => {
  const { viewer } = await setup(t, "unicode.txt", `${"İ".repeat(300)}Needle\n${"after\n".repeat(30)}`);
  await screen(viewer, value => value.includes("İ"), 20);
  viewer.handleInput("/"); type(viewer, "needle");
  const frame = stripVTControlCharacters(viewer.render(20).join("\n"));
  assert.match(frame, /Needle/);
  assert.doesNotMatch(frame, /No match/);
});

test("Markdown formatting joins inline words but preserves hard text boundaries", async t => {
  const source = "**supercalifrag**ilisticexpialidocious\n\nhello  \nworld\n\n- left\n- right\n\n```\ncode\nline\n```\n";
  const { viewer } = await setup(t, "boundaries.md", source);
  await screen(viewer, value => value.includes("super"), 5);
  viewer.handleInput("/"); type(viewer, "supercalifragilisticexpialidocious");
  const body = viewer.render(5).slice(2, -2).map(stripVTControlCharacters).join("");
  assert.match(body, /supercalifragilisticexpialidocious/);
  assert.match(stripVTControlCharacters(viewer.render(120)[0]), /match 1/);
  for (const query of ["hello world", "left right", "code line"]) {
    viewer.render(20);
    viewer.handleInput("/"); viewer.handleInput("\x15"); type(viewer, query);
    assert.match(stripVTControlCharacters(viewer.render(120).at(-1)!), /^No match:/);
  }
});
