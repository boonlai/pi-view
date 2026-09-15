import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, truncate } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { marked, type Token } from "marked";
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
  if (first.kind === "text") assert.equal(marked.lexer(first.text).links["ref"]?.href, "https://example.com");
});

test("Escaped pipes in table cells and header alts still expose images", () => {
  const row = markdownBlocks("| Description |\n| --- |\n| foo\\|bar ![alt](pic.png) |");
  assert.deepEqual(row.filter(block => block.kind === "image").map(block => block.target), ["pic.png"]);
  const header = markdownBlocks("| ![a\\|b](x.png) |\n| --- |\n| body |");
  assert.deepEqual(header.filter(block => block.kind === "image").map(block => block.alt), ["a|b"]);
  // \\\\ is an escaped backslash; the pipe after it still splits the row in two.
  const doubled = markdownBlocks("| a\\\\|b ![m](n.png) |\n| --- |\n| c |");
  assert.deepEqual(doubled.filter(block => block.kind === "image").map(block => block.target), ["n.png"]);
  assert.deepEqual(markdownBlocks("| `![fake](bad.png)` |\n| --- |\n| x |").filter(block => block.kind === "image"), []);
});

test("Reference definitions resolve per fragment without copying the table", () => {
  const source = "para [a][one]\n\n![i1](1.png)\n\npara [b][two]\n\n![i2](2.png)\n\n[one]: https://one.example\n[two]: https://two.example\n";
  const blocks = markdownBlocks(source);
  const first = blocks[0], second = blocks[2];
  assert.equal(first.kind, "text");
  assert.equal(second.kind, "text");
  if (first.kind === "text") {
    const fragment = marked.lexer(first.text);
    assert.equal(fragment.links["one"]?.href, "https://one.example");
    assert.ok(!fragment.links["two"]);
  }
  if (second.kind === "text") {
    const fragment = marked.lexer(second.text);
    assert.equal(fragment.links["two"]?.href, "https://two.example");
    assert.ok(!fragment.links["one"]);
  }
  // 300 image-separated paragraphs over 300 definitions must not copy the
  // definition table into every fragment.
  const defs = Array.from({ length: 300 }, (_, i) => `[d${i}]: https://example.invalid/${i}`).join("\n");
  const paragraphs = Array.from({ length: 300 }, (_, i) => `para ${i}\n\n![i](${i}.png)\n`).join("\n");
  const amplifiedSource = `${paragraphs}\n${defs}\n`;
  const amplified = markdownBlocks(amplifiedSource)
    .reduce((sum, block) => sum + (block.kind === "text" ? block.text.length : 0), 0);
  assert.ok(amplified - amplifiedSource.length < 64 * 1024, `expansion ${amplified - amplifiedSource.length}`);
  // Documents whose reference expansion would exceed the aggregate budget are
  // rejected outright instead of silently dropping reference links.
  const destination = `https://example.invalid/${"a".repeat(100_000)}`;
  const repeatedSource = `${Array.from({ length: 40 }, (_, i) => `para ${i} [x][big]\n\n![i](${i}.png)\n`).join("\n")}\n[big]: ${destination}\n`;
  assert.throws(() => markdownBlocks(repeatedSource), /expansion budget/);
});

test("Escaped, collapsed and shortcut references resolve across fragments", () => {
  const source = [
    "Escaped [x][a\\]b], bracket [y][b\\[c], backslash [z][c\\\\d].",
    "",
    "![split1](1.png)",
    "",
    "Collapsed [collapsed][] and shortcut [short].",
    "",
    "![split2](2.png)",
    "",
    "[a\\]b]: https://example.invalid/1",
    "[b\\[c]: https://example.invalid/2",
    "[c\\\\d]: https://example.invalid/3",
    "[collapsed]: https://example.invalid/4",
    "[short]: https://example.invalid/5",
  ].join("\n") + "\n";
  const blocks = markdownBlocks(source);
  assert.deepEqual(blocks.filter(block => block.kind === "image").map(block => block.target), ["1.png", "2.png"]);
  const texts = blocks.filter(block => block.kind === "text");
  const linkHrefs = (text: string): string[] => {
    const found: string[] = [];
    const walk = (tokens: Token[]): void => {
      for (const token of tokens) {
        if (token.type === "link" || token.type === "image") found.push(token.href);
        if (token.type !== "code" && token.type !== "codespan" && token.type !== "html"
          && "tokens" in token && Array.isArray(token.tokens)) walk(token.tokens);
        if (token.type === "list") walk(token.items);
      }
    };
    walk(marked.lexer(text));
    return found;
  };
  // The escaped-], escaped-[ and backslash labels resolve semantically; the
  // serialized definitions must re-lex to the same keys marked produced.
  assert.deepEqual(linkHrefs(texts[0].text).sort(), [
    "https://example.invalid/1",
    "https://example.invalid/2",
    "https://example.invalid/3",
  ]);
  // Collapsed and shortcut references resolve in the later fragment.
  assert.deepEqual(linkHrefs(texts[1].text).sort(), [
    "https://example.invalid/4",
    "https://example.invalid/5",
  ]);
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

test("Markdown image targets accept URL query and fragment suffixes", async t => {
  const dir = await fixture(t);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  await writeFile(join(dir, "picture.png"), png);
  await writeFile(join(dir, "literal#name.png"), png);
  assert.equal((await loadImage("picture.png?v=1", dir, false)).width, 10);
  assert.equal((await loadImage("picture.png#fragment", dir, false)).width, 10);
  assert.equal((await loadImage("literal%23name.png", dir, false)).width, 10);
  if (process.platform !== "win32") {
    await writeFile(join(dir, "literal?name.png"), png);
    assert.equal((await loadImage("literal%3Fname.png#fragment", dir, false)).width, 10);
  }
  await assert.rejects(loadImage("missing.png#frag", dir, false), /ENOENT/);
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

test("SVG containers and namespace tricks cannot bypass the preflight", async t => {
  const dir = await fixture(t);
  const svg = join(dir, "image.svg");
  const benign = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';
  await writeFile(svg, gzipSync(Buffer.from(benign)));
  await assert.rejects(loadImage(svg, dir, false), /SVGZ/);
  const scripted = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>1</script><rect width="8" height="8"/></svg>';
  await writeFile(svg, gzipSync(Buffer.from(scripted)));
  await assert.rejects(loadImage(svg, dir, false), /SVGZ/);
  await writeFile(svg, '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="8" height="8"><svg:script>1</svg:script><svg:rect width="8" height="8"/></svg:svg>');
  await assert.rejects(loadImage(svg, dir, false), /scripts, entities/);
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:π="http://www.w3.org/2000/svg" width="8" height="8"><π:script>1</π:script><rect width="8" height="8"/></svg>');
  await assert.rejects(loadImage(svg, dir, false), /scripts, entities/);
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><svg:foreignObject>1</svg:foreignObject></svg>');
  await assert.rejects(loadImage(svg, dir, false), /scripts, entities/);
  await writeFile(svg, benign);
  assert.equal((await loadImage(svg, dir, false)).width, 8);
});

test("SVG preflight does not interpret raster EXIF metadata as a document", async t => {
  const dir = await fixture(t);
  const file = join(dir, "metadata.jpg");
  await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } })
    .withExif({ IFD0: { ImageDescription: '<svg><script>inert metadata</script></svg>' } })
    .jpeg().toFile(file);
  const image = await loadImage(file, dir, false);
  assert.equal(image.width, 4);
  assert.equal(image.height, 3);
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

test("Crop bands separate transparent letterbox rows from partial content rows", async t => {
  const dir = await fixture(t);
  const file = join(dir, "band.png");
  await sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).png().toFile(file);
  const image = await loadImage(file, dir, false);
  // Fit of 8x4 into 8x8 leaves two transparent letterbox rows above and below
  // the four content rows; every band therefore exercises the same pipeline.
  const rows = async (cropTopPx: number, cropHeightPx: number): Promise<string[]> => {
    const png = await renderRaster(image, { widthPx: 8, heightPx: 8, zoom: 1, panX: 0.5, panY: 0.5, cropTopPx, cropHeightPx });
    const raw = await sharp(png).ensureAlpha().raw().toBuffer();
    return Array.from({ length: raw.length / 32 }, (_, row) => {
      const pixels = raw.subarray(row * 32, (row + 1) * 32);
      const blank = pixels.every(byte => byte === 0);
      const red = [...pixels].every((byte, index) => index % 4 === 3 ? byte === 255 : byte === (index % 4 === 0 ? 255 : 0));
      return blank ? "blank" : red ? "content" : "mixed";
    });
  };
  assert.deepEqual(await rows(0, 2), ["blank", "blank"]); // band entirely above the content
  assert.deepEqual(await rows(6, 2), ["blank", "blank"]); // band entirely below the content
  assert.deepEqual(await rows(1, 3), ["blank", "content", "content"]); // leading letterbox row
  assert.deepEqual(await rows(5, 3), ["content", "blank", "blank"]); // trailing letterbox rows
  assert.deepEqual(await rows(0, 8), ["blank", "blank", "content", "content", "content", "content", "blank", "blank"]);
});

test("PDF renders a real page and extracts searchable text", async t => {
  const diagnostic = await mediaDiagnostics();
  if (diagnostic.filter(line => /^(pdfinfo|pdftoppm|pdftotext): available$/.test(line)).length < 3) { t.skip("Poppler is not installed"); return; }
  // A missing image worker must fail here, not masquerade as missing Poppler.
  assert.equal(diagnostic.find(line => line.startsWith("Node image worker")), "Node image worker: available");
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

test("An aborted image job does not poison the next worker request", async t => {
  const dir = await fixture(t);
  const file = join(dir, "worker.png");
  await sharp({ create: { width: 50, height: 20, channels: 3, background: "blue" } }).png().toFile(file);
  const image = await loadImage(file, dir, false);
  const options = { widthPx: 100, heightPx: 40, zoom: 1, panX: 0.5, panY: 0.5 };
  const abort = new AbortController();
  const pending = renderRaster(image, options, abort.signal);
  abort.abort();
  await assert.rejects(pending, /aborted/);
  const recovered = await sharp(await renderRaster(image, options)).metadata();
  assert.equal(recovered.width, 100);
  assert.equal(recovered.height, 40);
});
