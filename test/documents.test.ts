import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadDocument, loadImage, loadPdfPage, markdownBlocks, mediaDiagnostics, pdfText, renderRaster, safeText } from "../src/documents.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function samplePdf(): Buffer {
  const stream = "BT /F1 18 Tf 20 70 Td (Preview document) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
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

test("Markdown extracts real inline, reference and nested images, not code examples", () => {
  const source = "# Title\n\n`![fake](bad.png)` then ![real](ok.png)\n\n```md\n![fake](bad.png)\n```\n\n- ![nested][picture]\n\n[picture]: nested.svg\n";
  const blocks = markdownBlocks(source);
  assert.deepEqual(blocks.filter(block => block.kind === "image").map(block => block.target), ["ok.png", "nested.svg"]);
  const text = blocks.filter(block => block.kind === "text").map(block => block.text).join("");
  assert.match(text, /`!\[fake\]\(bad.png\)`/);
  assert.match(text, /```md\n!\[fake\]\(bad.png\)/);
});

test("Quoted and indented Markdown images retain references across split text blocks", () => {
  const source = "[link][ref]\n\n> Intro\n> ![quoted](quote.png)\n\n- Intro\n  ![listed](list.svg)\n\n![last](last.png)\n\n[ref]: https://example.com\n";
  const blocks = markdownBlocks(source);
  assert.deepEqual(blocks.filter(block => block.kind === "image").map(block => block.target), ["quote.png", "list.svg", "last.png"]);
  const first = blocks[0];
  assert.equal(first.kind, "text");
  if (first.kind === "text") assert.match(first.text, /\[ref\]: <https:\/\/example.com>/);
});

test("Text and media reject terminal controls, unsupported HTML, binary and oversized input", async t => {
  const dir = await fixture(t);
  assert.equal(safeText("before\x1b]52;c;clipboard\x07\x1b_Gpayload\x1b\\\x1b[31mred\x1b[0m\x00\r\nafter"), "beforered\nafter");
  const text = join(dir, "source.ts");
  await writeFile(text, "const x = 1;\x1b[2J");
  const doc = await loadDocument(text);
  assert.equal(doc.kind, "text");
  if (doc.kind === "text") assert.equal(doc.source, "const x = 1;");
  await writeFile(join(dir, "page.html"), "<h1>Not supported</h1>");
  await assert.rejects(loadDocument(join(dir, "page.html")), /not supported/);
  await writeFile(join(dir, "binary"), Buffer.from([0, 255, 1]));
  await assert.rejects(loadDocument(join(dir, "binary")), /not a supported|Binary/);
  await truncate(text, 3 * 1024 * 1024);
  await assert.rejects(loadDocument(text), /preview limit/);
  await assert.rejects(loadImage("https://example.invalid/a.png", dir, false), /not fetched/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(loadDocument(text, abort.signal), /abort/i);
});

test("All supported image formats produce a static PNG; SVG resource loading is rejected", async t => {
  const dir = await fixture(t);
  for (const format of ["png", "jpeg", "gif", "webp"] as const) {
    const file = join(dir, `a%20b.${format}`);
    await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).toFormat(format).toFile(file);
    const doc = await loadDocument(file);
    assert.equal(doc.kind, "image");
    if (doc.kind === "image") {
      const metadata = await sharp(doc.image.data).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, 20);
      assert.equal(metadata.height, 10);
      assert.ok(!metadata.pages || metadata.pages === 1);
    }
  }
  const svg = join(dir, "image.svg");
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="20" height="10" fill="url(\'#g\')"/></svg>');
  const image = await loadImage(svg, dir, false);
  assert.equal(image.width, 20);
  assert.equal(image.height, 10);
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>');
  await assert.rejects(loadImage(svg, dir, false), /external resources/);
});

test("Raster viewport crops at row boundaries and pans actual pixels without oversized output", async t => {
  const dir = await fixture(t);
  const file = join(dir, "split.png");
  const red = await sharp({ create: { width: 50, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 50, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  await sharp({ create: { width: 100, height: 10, channels: 3, background: "black" } })
    .composite([{ input: red, left: 0, top: 0 }, { input: blue, left: 50, top: 0 }]).png().toFile(file);
  const image = await loadImage(file, dir, false);
  const options = { widthPx: 50, heightPx: 10, zoom: 4, panX: 0, panY: 0.5 };
  const left = await sharp(await renderRaster(image, options)).removeAlpha().raw().toBuffer();
  const right = await sharp(await renderRaster(image, { ...options, panX: 1 })).removeAlpha().raw().toBuffer();
  assert.deepEqual([...left.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...right.subarray(0, 3)], [0, 0, 255]);
  const cropped = await sharp(await renderRaster(image, { ...options, cropTopPx: 3, cropHeightPx: 4 })).metadata();
  assert.equal(cropped.width, 50); assert.equal(cropped.height, 4);
  await assert.rejects(renderRaster(image, { ...options, widthPx: 99999 }), /size limit/);
});

test("PDF renders a real page and extracts searchable text", async t => {
  const diagnostic = await mediaDiagnostics();
  if (diagnostic.some(line => !line.endsWith(": available"))) { t.skip("Poppler is not installed"); return; }
  const dir = await fixture(t);
  const file = join(dir, "sample.pdf");
  await writeFile(file, samplePdf());
  const document = await loadDocument(file);
  assert.equal(document.kind, "pdf");
  if (document.kind === "pdf") assert.equal(document.pages, 1);
  const image = await loadPdfPage(file, 1);
  assert.equal(image.width, 2400); assert.equal(image.height, 1200);
  assert.match(await pdfText(file), /Preview document/);
  await assert.rejects(loadPdfPage(file, 0), /page number/);
});

test("SVG embedded rasters have a cumulative pre-decode pixel budget", async t => {
  const dir = await fixture(t);
  const png = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: "red" } }).png().toBuffer();
  const embedded = `<image href="data:image/png;base64,${png.toString("base64")}"/>`;
  const file = join(dir, "oversized.svg");
  await writeFile(file, `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${embedded.repeat(3)}</svg>`);
  await assert.rejects(loadImage(file, dir, false), /cumulative 40 megapixel/);
});
