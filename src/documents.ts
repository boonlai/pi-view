import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, type ExecFileException } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { marked, type Token } from "marked";
import sharp from "sharp";

export interface ImageSource { data: Buffer; width: number; height: number; label: string }
export type DocumentBlock = { kind: "text"; text: string } | { kind: "image"; target: string; alt: string };
export type PreviewDocument =
  | { kind: "text" | "markdown"; path: string; source: string; language?: string; blocks: DocumentBlock[] }
  | { kind: "image"; path: string; image: ImageSource }
  | { kind: "pdf"; path: string; pages: number };
export interface RasterOptions {
  widthPx: number; heightPx: number; zoom: number; panX: number; panY: number;
  actualSize?: boolean; cropTopPx?: number; cropHeightPx?: number;
}
const TEXT_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 32 * 1024 * 1024;
const PDF_LIMIT = 128 * 1024 * 1024;
const PIXEL_LIMIT = 40_000_000;
const imageExtensions: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true };

export function safeText(text: string): string {
  return stripVTControlCharacters(text.replace(/\x1b[P_^][\s\S]*?(?:\x1b\\|$)/g, ""))
    .replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

async function boundedRead(path: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Only regular files can be previewed");
    if (stat.size > limit) throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MiB preview limit`);
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size || length > limit) throw new Error("File changed while reading; reload the preview");
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

// Walk token ranges, not a source regex: image-looking examples in code stay code.
export function markdownBlocks(source: string): DocumentBlock[] {
  const spans: { start: number; end: number; target: string; alt: string }[] = [];
  // Marked removes quote/list prefixes from child raw text. Match in the same
  // normalized coordinate space, then translate image spans back to the file.
  const prefix = /^[ \t]*(?:(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)[ \t]*)*/gm;
  const positions: number[] = [];
  let normalized = "";
  for (const match of source.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const stripped = line.replace(prefix, "");
    const removed = line.length - stripped.length;
    normalized += stripped;
    for (let i = removed; i < line.length; i++) positions.push(match.index + i);
  }
  function visit(tokens: Token[], start: number, end: number): void {
    let cursor = start;
    for (const token of tokens) {
      const raw = token.raw?.replace(prefix, "");
      if (!raw) continue;
      const at = normalized.indexOf(raw, cursor);
      if (at < cursor || at + raw.length > end) continue;
      const stop = at + raw.length;
      cursor = stop;
      if (token.type === "image") {
        spans.push({ start: positions[at], end: positions[stop - 1] + 1, target: token.href, alt: token.text });
      } else if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens, at, stop);
        if (token.type === "list") visit(token.items, at, stop);
        if (token.type === "table") {
          // Cells expose parsed inline tokens rather than raw block tokens.
          let cellCursor = at;
          for (const cell of [...token.header, ...token.rows.flat()]) {
            const text = cell.text.replace(prefix, "");
            const cellAt = normalized.indexOf(text, cellCursor);
            if (cellAt >= cellCursor && cellAt < stop) {
              visit(cell.tokens, cellAt, cellAt + text.length);
              cellCursor = cellAt + text.length;
            }
          }
        }
      }
    }
  }
  const tokens = marked.lexer(source);
  visit(tokens, 0, normalized.length);
  const definitions = Object.entries(tokens.links).map(([name, link]) =>
    `[${name.replace(/[\]\\]/g, "\\$&")}]: <${link.href.replace(/>/g, "%3E")}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`).join("\n");
  const blocks: DocumentBlock[] = [];
  let cursor = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start < cursor) continue;
    if (span.start > cursor) blocks.push({ kind: "text", text: source.slice(cursor, span.start) });
    blocks.push({ kind: "image", target: span.target, alt: safeText(span.alt) });
    cursor = span.end;
  }
  if (cursor < source.length) blocks.push({ kind: "text", text: source.slice(cursor) });
  if (definitions) for (const block of blocks) if (block.kind === "text") block.text += `\n\n${definitions}\n`;
  return blocks;
}

export async function loadDocument(path: string, signal?: AbortSignal): Promise<PreviewDocument> {
  const extension = extname(path).toLowerCase();
  if ([".html", ".htm", ".xhtml", ".mhtml", ".mht"].includes(extension)) {
    throw new Error("HTML and webpage preview are intentionally not supported");
  }
  if (imageExtensions[extension]) return { kind: "image", path, image: await loadImage(pathToFileURL(path).href, dirname(path), false, signal) };
  if (extension === ".pdf") {
    await checkPdf(path, signal);
    const info = await run("pdfinfo", [path], signal);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("Could not read PDF page count (encrypted or invalid PDF)");
    return { kind: "pdf", path, pages };
  }
  const bytes = await boundedRead(path, TEXT_LIMIT, signal);
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("This is not a supported image/PDF or UTF-8 text file"); }
  if (source.includes("\0")) throw new Error("Binary file preview is not supported");
  source = safeText(source);
  const markdown = [".md", ".markdown", ".mdown", ".mkd"].includes(extension);
  return { kind: markdown ? "markdown" : "text", path, source, language: extension.slice(1),
    blocks: markdown ? markdownBlocks(source) : [{ kind: "text", text: source }] };
}

async function remoteImage(url: string, signal?: AbortSignal): Promise<Buffer> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Unsupported image URL");
  const abort = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  const response = await fetch(parsed, { signal: abort, credentials: "omit" });
  if (!response.ok || !response.body) throw new Error(`Image download failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_LIMIT) throw new Error("Remote image exceeds the 32 MiB limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

async function checkSvg(bytes: Buffer, signal?: AbortSignal): Promise<void> {
  const text = bytes.toString("utf8");
  if (!/<svg[\s>]/i.test(text)) return;
  const externalUrl = [...text.matchAll(/url\(([^)]*)\)/gi)].some(match => !match[1].trim().replace(/^["']|["']$/g, "").startsWith("#"));
  const externalHref = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)]
    .some(match => !/^(?:#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(match[1].trim()));
  if (/<!DOCTYPE|<!ENTITY|<script[\s>]|<foreignObject[\s>]|<\?xml-stylesheet|@import/i.test(text)
    || externalHref || externalUrl) {
    throw new Error("SVG scripts, entities and external resources are not allowed");
  }
  let embeddedPixels = 0;
  for (const match of text.matchAll(/(?:href|src)\s*=\s*["']\s*data:image\/(?:png|jpeg|gif|webp);base64,([^"']*)["']/gi)) {
    signal?.throwIfAborted();
    const metadata = await sharp(Buffer.from(match[1], "base64"), { limitInputPixels: PIXEL_LIMIT }).metadata();
    embeddedPixels += (metadata.width ?? PIXEL_LIMIT) * (metadata.height ?? PIXEL_LIMIT) * (metadata.pages ?? 1);
    if (embeddedPixels > PIXEL_LIMIT) throw new Error("Embedded SVG images exceed the cumulative 40 megapixel limit");
  }
}

async function decodeImage(bytes: Buffer, label: string, signal?: AbortSignal): Promise<ImageSource> {
  signal?.throwIfAborted();
  await checkSvg(bytes, signal);
  const decoded = await sharp(bytes, { limitInputPixels: PIXEL_LIMIT, animated: false, page: 0, pages: 1 })
    .rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  signal?.throwIfAborted();
  if (decoded.data.length > IMAGE_LIMIT) throw new Error("Decoded image exceeds the 32 MiB limit");
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height, label: safeText(label) };
}

export async function loadImage(target: string, baseDir: string, allowRemote: boolean, signal?: AbortSignal): Promise<ImageSource> {
  let bytes: Buffer;
  if (/^https?:\/\//i.test(target)) {
    if (!allowRemote) throw new Error("Remote image not fetched; press R to allow remote images for this preview");
    bytes = await remoteImage(target, signal);
  } else if (/^data:/i.test(target)) {
    const match = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(target);
    if (!match || target.length > IMAGE_LIMIT * 1.4) throw new Error("Unsupported or oversized embedded image");
    bytes = Buffer.from(match[1], "base64");
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith("file:") && !/^[a-z]:[\\/]/i.test(target)) throw new Error("Unsupported image scheme");
    let path = target.startsWith("file:") ? fileURLToPath(target) : target;
    if (!target.startsWith("file:")) { try { path = decodeURIComponent(path); } catch {} }
    bytes = await boundedRead(resolve(baseDir, path), IMAGE_LIMIT, signal);
  }
  return decodeImage(bytes, target.startsWith("data:") ? "embedded image" : target, signal);
}

export async function renderRaster(image: ImageSource, options: RasterOptions, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const { widthPx, heightPx } = options;
  if (![widthPx, heightPx].every(v => Number.isInteger(v) && v > 0 && v <= 4096) || widthPx * heightPx > 8_000_000) {
    throw new Error("Preview viewport exceeds the raster size limit");
  }
  const zoom = Math.max(0.05, Math.min(32, Number.isFinite(options.zoom) ? options.zoom : 1));
  const scale = (options.actualSize ? 1 : Math.min(widthPx / image.width, heightPx / image.height)) * zoom;
  const regionW = Math.min(image.width, Math.max(1, Math.ceil(widthPx / scale)));
  const regionH = Math.min(image.height, Math.max(1, Math.ceil(heightPx / scale)));
  const clampPan = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  const left = Math.round((image.width - regionW) * clampPan(options.panX));
  const top = Math.round((image.height - regionH) * clampPan(options.panY));
  const outW = Math.max(1, Math.min(widthPx, Math.round(regionW * scale)));
  const outH = Math.max(1, Math.min(heightPx, Math.round(regionH * scale)));
  const imageBytes = await sharp(image.data).extract({ left, top, width: regionW, height: regionH })
    .resize(outW, outH, { fit: "fill" }).png().toBuffer();
  signal?.throwIfAborted();
  const canvas = await sharp({ create: { width: widthPx, height: heightPx, channels: 4, background: "#00000000" } })
    .composite([{ input: imageBytes, left: Math.floor((widthPx - outW) / 2), top: Math.floor((heightPx - outH) / 2) }])
    .png().toBuffer();
  const cropTop = Math.max(0, Math.min(heightPx - 1, Math.floor(options.cropTopPx ?? 0)));
  const cropHeight = Math.max(1, Math.min(heightPx - cropTop, Math.floor(options.cropHeightPx ?? heightPx)));
  signal?.throwIfAborted();
  return cropTop || cropHeight !== heightPx
    ? sharp(canvas).extract({ left: 0, top: cropTop, width: widthPx, height: cropHeight }).png().toBuffer()
    : canvas;
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  const { promise, resolve: resolveResult, reject } = Promise.withResolvers<string>();
  let failure: ExecFileException | null = null;
  let output = "";
  const child = execFile(command, args, {
    signal, timeout: 20_000, killSignal: "SIGKILL", maxBuffer: TEXT_LIMIT, encoding: "utf8", windowsHide: true,
  }, (error, stdout) => { failure = error; output = stdout; });
  // An AbortSignal invokes execFile's callback before the process has exited.
  // Wait for close before callers remove output files or start another decoder.
  child.once("close", () => {
    if (failure?.code === "ENOENT") reject(new Error(`${command} is missing. Install Poppler (brew install poppler / apt install poppler-utils).`));
    else if (failure) reject(new Error(safeText(failure.message)));
    else resolveResult(output);
  });
  return promise;
}

async function checkPdf(path: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > PDF_LIMIT) throw new Error("PDF must be a regular file no larger than 128 MiB");
    const signature = Buffer.alloc(5);
    await file.read(signature, 0, 5, 0);
    if (signature.toString() !== "%PDF-") throw new Error("Invalid PDF signature");
  } finally { await file.close(); }
}

export async function loadPdfPage(path: string, page: number, signal?: AbortSignal): Promise<ImageSource> {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid PDF page number");
  await checkPdf(path, signal);
  const dir = await mkdtemp(join(tmpdir(), "pi-view-"));
  try {
    const prefix = join(dir, "page");
    await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400", "-png", path, prefix], signal);
    return decodeImage(await boundedRead(`${prefix}.png`, IMAGE_LIMIT, signal), `${path} · page ${page}`, signal);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function pdfText(path: string, signal?: AbortSignal): Promise<string> {
  await checkPdf(path, signal);
  return safeText(await run("pdftotext", ["-layout", path, "-"], signal));
}

export async function mediaDiagnostics(): Promise<string[]> {
  return Promise.all(["pdfinfo", "pdftoppm", "pdftotext"].map(async command => {
    try { await run(command, ["-v"]); return `${command}: available`; }
    catch (error) { return `${command}: ${safeText((error as Error).message)}`; }
  }));
}
