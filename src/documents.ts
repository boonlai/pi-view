import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, type ExecFileException } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { marked, type Token } from "marked";
import { decodeImage } from "./image-client.ts";
export { renderRaster } from "./image-client.ts";

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
const REFERENCE_BUDGET = 1024 * 1024;
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
  const usages: { start: number; href: string; title: string | null }[] = [];
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
  function recordImage(at: number, stop: number, target: string, alt: string): void {
    spans.push({ start: positions[at], end: positions[stop - 1] + 1, target, alt });
  }
  function recordUsage(at: number, href: string, title?: string | null): void {
    usages.push({ start: positions[at], href, title: title ?? null });
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
      if (token.type === "image") recordImage(at, stop, token.href, token.text);
      else if (token.type === "link" && raw.startsWith("[") && raw.endsWith("]")) recordUsage(at, token.href, token.title);
      if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens, at, stop);
        if (token.type === "list") visit(token.items, at, stop);
        if (token.type === "table") mapCells([...token.header, ...token.rows.flat()], at, stop);
      }
    }
  }
  // Table cells arrive pipe-unescaped (marked keeps \\ and turns \| into |,
  // splitting rows on pipes with an even backslash run): rebuild that exact
  // unescaped text with an offset map and locate cell raws there, so mapping
  // stays linear and cells can never match at a later duplicate occurrence.
  function mapCells(cells: { text: string; tokens?: Token[] }[], at: number, stop: number): void {
    const tableRaw = normalized.slice(at, stop);
    let plain = "";
    const map: number[] = [];
    let slashes = 0;
    for (let i = 0; i < tableRaw.length;) {
      map.push(i);
      const ch = tableRaw[i];
      if (ch === "\\" && tableRaw[i + 1] === "|" && slashes % 2 === 0) { plain += "|"; slashes = 0; i += 2; continue; }
      plain += ch;
      slashes = ch === "\\" ? slashes + 1 : 0;
      i += 1;
    }
    map.push(tableRaw.length);
    let cellCursor = 0;
    for (const cell of cells) {
      const cellAt = plain.indexOf(cell.text, cellCursor);
      if (cellAt < 0) continue;
      const cellEnd = cellAt + cell.text.length;
      cellCursor = cellEnd;
      visitCell(cell.tokens ?? [], plain, at, map, cellAt, cellEnd);
    }
  }
  function visitCell(tokens: Token[], plain: string, base: number, map: number[], start: number, end: number): void {
    let cursor = start;
    for (const token of tokens) {
      const raw = token.raw;
      if (!raw) continue;
      const at = plain.indexOf(raw, cursor);
      if (at < cursor || at + raw.length > end) continue;
      const stop = at + raw.length;
      cursor = stop;
      if (token.type === "image") recordImage(base + map[at], base + map[stop], token.href, token.text);
      else if (token.type === "link" && raw.startsWith("[") && raw.endsWith("]")) recordUsage(base + map[at], token.href, token.title);
      if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visitCell(token.tokens, plain, base, map, at, stop);
      }
    }
  }
  const tokens = marked.lexer(source);
  visit(tokens, 0, normalized.length);
  // Marked already resolved every reference, so keep only the definitions
  // whose (href, title) each fragment actually links to rather than copying
  // the whole table into every fragment. Documents above the budget are
  // rejected outright instead of silently dropping reference links.
  const definitions = new Map<string, string[]>();
  for (const [name, link] of Object.entries(tokens.links)) {
    const key = `${link.href}\u0000${link.title ?? ""}`;
    const line = `[${name}]: <${link.href.replace(/>/g, "%3E")}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`;
    const group = definitions.get(key);
    if (group) group.push(line); else definitions.set(key, [line]);
  }
  const blocks: DocumentBlock[] = [];
  const fragments: { block: Extract<DocumentBlock, { kind: "text" }>; from: number; to: number }[] = [];
  let cursor = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      const block: DocumentBlock = { kind: "text", text: source.slice(cursor, span.start) };
      blocks.push(block);
      fragments.push({ block, from: cursor, to: span.start });
    }
    blocks.push({ kind: "image", target: span.target, alt: safeText(span.alt) });
    cursor = span.end;
  }
  if (cursor < source.length) {
    const block: DocumentBlock = { kind: "text", text: source.slice(cursor) };
    blocks.push(block);
    fragments.push({ block, from: cursor, to: source.length });
  }
  const sortedUsages = usages.sort((a, b) => a.start - b.start);
  let usageCursor = 0;
  let budget = REFERENCE_BUDGET;
  for (const { block, from, to } of fragments) {
    const used = new Set<string>();
    while (usageCursor < sortedUsages.length && sortedUsages[usageCursor].start < from) usageCursor++;
    for (let i = usageCursor; i < sortedUsages.length && sortedUsages[i].start < to; i++) {
      used.add(`${sortedUsages[i].href}\u0000${sortedUsages[i].title ?? ""}`);
    }
    if (!used.size) continue;
    const lines: string[] = [];
    for (const key of used) {
      for (const line of definitions.get(key) ?? []) {
        if (line.length > budget) throw new Error(`Markdown reference definitions exceed the ${Math.round(REFERENCE_BUDGET / 1024 / 1024)} MiB expansion budget`);
        budget -= line.length;
        lines.push(line);
      }
    }
    block.text += `\n\n${lines.join("\n")}\n`;
  }
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
    if (!target.startsWith("file:")) {
      // Markdown destinations are URLs: a ?query/#fragment suffix addresses
      // the same file, and percent escapes decode to literal file names.
      const suffix = path.search(/[?#]/);
      if (suffix >= 0) path = path.slice(0, suffix);
      try { path = decodeURIComponent(path); } catch {}
    }
    bytes = await boundedRead(resolve(baseDir, path), IMAGE_LIMIT, signal);
  }
  return decodeImage(bytes, target.startsWith("data:") ? "embedded image" : target, signal);
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
    if (failure?.code === "ENOENT") {
      const poppler = command === "pdfinfo" || command === "pdftoppm" || command === "pdftotext";
      reject(new Error(`${command} is missing${poppler ? ". Install Poppler (brew install poppler / apt install poppler-utils)." : ""}`));
    }
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
  const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
  return Promise.all([["pdfinfo"], ["pdftoppm"], ["pdftotext"], [node, "Node image worker"]].map(async ([command, label]) => {
    try {
      await run(command, label ? ["--version"] : ["-v"]);
      return `${label ?? command}: available`;
    } catch (error) { return `${label ?? command}: ${safeText((error as Error).message)}`; }
  }));
}
