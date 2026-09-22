import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { getCellDimensions, resetCapabilitiesCache, setCapabilityOverrides, setCellDimensions, visibleWidth, type TUI, type TuiInputListener } from "@earendil-works/pi-tui";
import sharp from "sharp";
import { PreviewViewer } from "../src/viewer.ts";
import { resetStateFile, setStateFile } from "../src/settings.ts";
import { mediaDiagnostics } from "../src/documents.ts";

initTheme("dark", false);
const theme = getThemeByName("dark")!;
async function setup(t: { after(fn: () => void | Promise<void>): void }, filename?: string, content?: string | Buffer, options?: { images?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-ui-test-"));
  setStateFile(join(dir, "settings.json"));
  const previous = process.env.PI_VIEW_IMAGES;
  process.env.PI_VIEW_IMAGES = options?.images ? "auto" : "off";
  const previousCell = getCellDimensions();
  if (options?.images) {
    setCapabilityOverrides({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 20 });
  }
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
    resetStateFile();
    if (previous === undefined) delete process.env.PI_VIEW_IMAGES; else process.env.PI_VIEW_IMAGES = previous;
    if (options?.images) { setCapabilityOverrides({}); resetCapabilitiesCache(); setCellDimensions(previousCell); }
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

const WHEEL_UP = "\x1b[<64;10;10M";
const WHEEL_DOWN = "\x1b[<65;10;10M";

function wheel(listeners: Set<TuiInputListener>, direction: "up" | "down"): void {
  const packet = direction === "up" ? WHEEL_UP : WHEEL_DOWN;
  for (const listener of [...listeners]) listener(packet);
}

function rawRender(viewer: PreviewViewer, width = 160): string {
  return viewer.render(width).join("\n");
}

async function rawScreen(viewer: PreviewViewer, predicate: (rendered: string) => boolean): Promise<string> {
  let rendered = "";
  for (let attempt = 0; attempt < 200; attempt++) {
    rendered = rawRender(viewer);
    if (predicate(rendered)) return rendered;
    await delay(20);
  }
  assert.fail(`Viewer never reached expected raw output:\n${stripVTControlCharacters(rendered)}`);
}

// Every displayed frame emits exactly one Kitty transmit header; its i= id is
// public output, so frame identity and retirement are observable without
// touching viewer internals.
function frameIds(rendered: string): number[] {
  return [...rendered.matchAll(/\x1b_G([^;]*);/g)]
    .filter(([, header]) => header.split(",").includes("a=T"))
    .map(([, header]) => Number(header.split(",").find(field => field.startsWith("i="))?.slice(2)))
    .filter(id => Number.isInteger(id));
}

async function framePixels(rendered: string): Promise<Buffer> {
  const data = [...rendered.matchAll(/\x1b_G[^;]*;([A-Za-z0-9+/=]+)(?=\x1b)/g)].map(match => match[1]).join("");
  return sharp(Buffer.from(data, "base64")).ensureAlpha().raw().toBuffer();
}

function deletedIds(writes: string[]): number[] {
  return [...writes.join("").matchAll(/\x1b_G([^;]*?)\x1b\\/g)]
    .map(([, header]) => header.split(","))
    .filter(fields => fields.includes("d=I"))
    .map(fields => Number(fields.find(field => field.startsWith("i="))?.slice(2)))
    .filter(id => Number.isInteger(id));
}

function rasterPng(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

function multiPagePdf(labels: string[]): Buffer {
  const colors = ["0.9 0.25 0.2", "0.2 0.7 0.3", "0.25 0.4 0.9"];
  const streams = labels.map((label, index) => `${colors[index % colors.length]} rg 0 0 200 100 re f 0 0 0 rg BT /F1 18 Tf 20 70 Td (${label} page) Tj ET`);
  const fontObject = 3 + labels.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${labels.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${labels.length} >>`,
    ...labels.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${3 + labels.length + index} 0 R >>`),
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("Remote image approval loads the image and restores the normal footer", async t => {
  const png = await rasterPng(40, 20, "green");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(png);
  });
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/image.png`;
  const { viewer } = await setup(t, "gallery.md", `# Gallery\n\n![Remote](${url})\n`, { images: true });
  const initial = await rawScreen(viewer, rendered => stripVTControlCharacters(rendered).includes("Gallery"));
  const normalFooter = stripVTControlCharacters(initial).split("\n").at(-1);
  await screen(viewer, value => value.includes("not fetched"), 160);
  assert.equal(requests, 0, "opening the preview must not fetch remote images");

  viewer.handleInput("R");
  rawRender(viewer);
  viewer.handleInput("n");
  rawRender(viewer);
  assert.equal(requests, 0, "declining consent must not start a request");
  viewer.handleInput("R");
  rawRender(viewer);
  viewer.handleInput("y");
  const loaded = await rawScreen(viewer, rendered => frameIds(rendered).length === 1);
  assert.equal(requests, 1, "approval downloads the image once");
  assert.equal(stripVTControlCharacters(loaded).split("\n").at(-1), normalFooter,
    "successful loading must not leave the earlier refusal in the footer");
});

test("Wheel never zooms a raster while plus, minus and reset still do", { timeout: 30_000 }, async t => {
  const { viewer, writes, listeners } = await setup(t, "photo.png", await rasterPng(60, 40, "red"), { images: true });
  const initial = await rawScreen(viewer, rendered => frameIds(rendered).length > 0);
  const shownId = frameIds(initial)[0];
  assert.equal(new Set(frameIds(initial)).size, 1);
  assert.match(stripVTControlCharacters(initial), /×1\.00/);
  assert.match(stripVTControlCharacters(initial), /arrows: pan/);
  assert.doesNotMatch(initial, /— loading/);

  wheel(listeners, "down"); wheel(listeners, "down"); wheel(listeners, "up"); wheel(listeners, "up");
  assert.equal(rawRender(viewer), initial); // wheel leaves fit zoom and pixels untouched
  assert.deepEqual(deletedIds(writes), []);

  viewer.handleInput("+");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.20/);
  assert.deepEqual(frameIds(rawRender(viewer)), [shownId]); // old pixels stay until replacement
  const zoomed = await rawScreen(viewer, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(shownId));
  const zoomedId = frameIds(zoomed)[0];
  assert.doesNotMatch(zoomed, /— loading/);

  viewer.handleInput("-");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.00/);
  assert.deepEqual(frameIds(rawRender(viewer)), [zoomedId]);
  viewer.handleInput("0");
  const reset = await rawScreen(viewer, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(zoomedId));
  assert.equal(frameIds(reset).length, 1);
  assert.doesNotMatch(reset, /— loading/);
  assert.deepEqual(deletedIds(writes), [shownId, zoomedId]); // each retired frame is deleted exactly once
});

test("Burst zoom and pan converge without dropping the displayed frame", { timeout: 30_000 }, async t => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="blue"/><rect y="20" width="60" height="20" fill="red"/></svg>';
  const { viewer, writes } = await setup(t, "strip.svg", svg, { images: true });
  const initial = await rawScreen(viewer, rendered => frameIds(rendered).length > 0);
  const shownId = frameIds(initial)[0];
  viewer.handleInput("+");
  assert.deepEqual(frameIds(rawRender(viewer)), [shownId]);
  viewer.handleInput("\x1b[B");
  const pending = rawRender(viewer);
  assert.deepEqual(frameIds(pending), [shownId]);
  assert.doesNotMatch(pending, /— loading/);
  assert.deepEqual(deletedIds(writes), []);

  // A burst must reach the same pixels as individually completed inputs,
  // regardless of how many intermediate transforms were coalesced.
  const { viewer: sequential } = await setup(t, "strip.svg", svg, { images: true });
  let prior = frameIds(await rawScreen(sequential, rendered => frameIds(rendered).length > 0))[0];
  sequential.handleInput("+");
  const zoomed = await rawScreen(sequential, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(prior));
  prior = frameIds(zoomed)[0];
  sequential.handleInput("\x1b[B");
  const panned = await rawScreen(sequential, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(prior));
  const expected = await framePixels(panned);
  assert.notDeepEqual(expected, await framePixels(zoomed));
  let final = "";
  for (let i = 0; i < 200; i++) {
    final = rawRender(viewer);
    assert.doesNotMatch(final, /— loading/);
    if ((await framePixels(final)).equals(expected)) break;
    await delay(20);
  }
  assert.deepEqual(await framePixels(final), expected);
  const retired = deletedIds(writes);
  assert.ok(retired.includes(shownId));
  assert.equal(new Set(retired).size, retired.length);
  assert.ok(!retired.includes(frameIds(final)[0]));
});

test("Wheel leaves a focused Markdown image fit while plus zooms it", { timeout: 30_000 }, async t => {
  const { dir, viewer, writes, listeners } = await setup(t, "doc.md", "# Doc\n\n![pic](pic.png)\n\nTail text.\n", { images: true });
  await writeFile(join(dir, "pic.png"), await rasterPng(50, 30, "green"));
  await rawScreen(viewer, rendered => frameIds(rendered).length > 0); // embedded fit frame
  viewer.handleInput("i");
  const focused = await rawScreen(viewer, rendered => /×1\.00/.test(stripVTControlCharacters(rendered)) && frameIds(rendered).length > 0);
  const focusedId = frameIds(focused)[0];

  wheel(listeners, "down"); wheel(listeners, "up");
  assert.equal(rawRender(viewer), focused);
  viewer.handleInput("+");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.20/);
  const zoomed = await rawScreen(viewer, rendered => {
    const ids = frameIds(rendered);
    return ids.length === 1 && !ids.includes(focusedId) && deletedIds(writes).includes(focusedId);
  });
  assert.doesNotMatch(zoomed, /— loading/);
});

test("Wheel pages and clamps a multi-page PDF while zoom and arrows keep working", { timeout: 120_000 }, async t => {
  const diagnostic = await mediaDiagnostics();
  if (diagnostic.filter(line => /^(pdfinfo|pdftoppm|pdftotext): available$/.test(line)).length < 3) { t.skip("Poppler is not installed"); return; }
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const { viewer, writes, listeners } = await setup(t, "book.pdf", multiPagePdf(["Red", "Green", "Blue"]), { images: true });
  const page = (rendered: string): string => stripVTControlCharacters(rendered).match(/page \d\/3/)?.[0] ?? "";
  const first = await rawScreen(viewer, rendered => page(rendered) === "page 1/3" && frameIds(rendered).length > 0);
  const firstId = frameIds(first)[0];

  wheel(listeners, "down"); wheel(listeners, "down"); wheel(listeners, "down");
  assert.equal(page(rawRender(viewer)), "page 2/3"); // one notch can emit several reports
  viewer.handleInput("+");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.20/);
  now += 199;
  wheel(listeners, "down");
  assert.equal(page(rawRender(viewer)), "page 2/3");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.20/);
  now++;
  wheel(listeners, "down");
  assert.equal(page(rawRender(viewer)), "page 3/3");
  assert.match(stripVTControlCharacters(rawRender(viewer)), /×1\.00/); // paging resets to fit
  wheel(listeners, "down");
  assert.equal(page(rawRender(viewer)), "page 3/3"); // clamped at the last page
  wheel(listeners, "up"); // reversing direction is immediately responsive
  assert.equal(page(rawRender(viewer)), "page 2/3");
  wheel(listeners, "up");
  assert.equal(page(rawRender(viewer)), "page 2/3");
  now += 200;
  wheel(listeners, "up");
  now += 200;
  wheel(listeners, "up");
  assert.equal(page(rawRender(viewer)), "page 1/3"); // clamped at the first page

  wheel(listeners, "down");
  viewer.handleInput("]");
  assert.equal(page(rawRender(viewer)), "page 3/3"); // keyboard navigation bypasses wheel pacing
  viewer.handleInput("[");
  assert.equal(page(rawRender(viewer)), "page 2/3");
  const second = await rawScreen(viewer, rendered => page(rendered) === "page 2/3" && frameIds(rendered).length > 0 && !frameIds(rendered).includes(firstId));
  const secondId = frameIds(second)[0];
  assert.ok(deletedIds(writes).includes(firstId)); // the paged-away placement is released
  assert.ok(!deletedIds(writes).includes(secondId));

  viewer.handleInput("+");
  const zoomed = await rawScreen(viewer, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(secondId));
  const zoomId = frameIds(zoomed)[0];
  viewer.handleInput("\x1b[B");
  const panned = await rawScreen(viewer, rendered => frameIds(rendered).length > 0 && !frameIds(rendered).includes(zoomId));
  assert.doesNotMatch(panned, /— loading/);
  assert.notDeepEqual(await framePixels(panned), await framePixels(zoomed));
  now += 200;
  wheel(listeners, "down");
  assert.equal(page(rawRender(viewer)), "page 3/3"); // wheel pages while panned, never zooms
});
