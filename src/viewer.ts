import { unwatchFile, watchFile, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { lexer, type Token } from "marked";
import { getLanguageFromPath, getMarkdownTheme, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, isKeyRelease, matchesKey, parseKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { listDirectory, MAX_LIST_ENTRIES, type FileEntry } from "./paths.ts";
import { loadDocument, loadImage, loadPdfPage, mediaDiagnostics, pdfText, renderRaster, safeText, type ImageSource, type PreviewDocument } from "./documents.ts";
import { attachMouse, capabilities, createTerminalImage, type TerminalImage } from "./host.ts";
import { flushLineNumbersSave, queueLineNumbersSave, readLineNumbers } from "./settings.ts";

type TextUnit = { content: string; spans: { row: number; start: number; end: number }[] };
type LayoutBlock = { kind: "text"; lines: string[]; units?: TextUnit[] } | { kind: "image"; target: string; alt: string; rows: number };
type SearchMatch = { row: number; endRow: number };
type SearchState = { query: string; matches: SearchMatch[] };
type Frame = { abort: AbortController; component?: TerminalImage; retired?: TerminalImage; error?: string; rendered?: string; pending?: string };
type LoadedImage = { image?: ImageSource; error?: string; promise?: Promise<ImageSource>; abort?: AbortController };

function markdownSourceUnits(source: string): string[] {
  const units: string[] = [];
  let content = "";
  const flush = (): void => {
    const text = content.replace(/\s+/g, " ").trim();
    if (text) units.push(text);
    content = "";
  };
  const walk = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === "code") {
        flush();
        for (const line of token.text.split("\n")) { content = line; flush(); }
      } else if (["br", "space", "hr", "html"].includes(token.type)) flush();
      else if (token.type === "list") {
        flush();
        for (const item of token.items) { walk(item.tokens); flush(); }
      } else if (token.type === "table") {
        flush();
        for (const row of [token.header, ...token.rows]) {
          for (const cell of row) { walk(cell.tokens); flush(); }
        }
      } else {
        if ("tokens" in token && Array.isArray(token.tokens)) walk(token.tokens);
        else if ("text" in token && typeof token.text === "string") content += token.text;
        if (token.type === "paragraph" || token.type === "heading" || token.type === "blockquote") flush();
      }
    }
  };
  for (const token of lexer(source)) { walk([token]); flush(); }
  return units;
}
const HELP = `pi-view — local previews; nothing is sent to the model

/view <path> or /v <path>    Tab completes files and directories
/view or /v                Quick Open: recent session files and paths
Cmd+P / Ctrl+P on Windows   Quick Open above any dialog (if forwarded)
/view --diagnostics        Terminal capabilities and PDF dependencies

Esc / Ctrl+C               Close and restore the agent UI
Up/Down, j/k, PgUp/PgDn     Scroll text; arrows pan an image
Home / End                 Start / end of text
/                          Search text (or filter the file picker)
n / N                      Next / previous search match
w                          Toggle line wrapping
l                          Toggle source line numbers (remembered)
s                          Markdown source / PDF extracted text
Enter or i                 Focus the first visible Markdown image
b                          Return from an image/help/diagnostics
+ / -                      Zoom a focused image or PDF page
0 / 1                      Fit / actual raster size
[ / ] or PgUp/PgDn         Previous / next PDF page
Mouse wheel                Scroll text or change PDF pages; no image zoom
g                          Jump to a PDF page
r                          Reload (source file changes also reload)
R                          Ask to load remote Markdown images
o                          Browse the current file's directory
? / d                      Help / diagnostics

PNG, JPEG, static GIF, WebP and SVG; SVG is rasterized.
Images are bounded to 4096px per side; actual size uses that raster.
PDF requires Poppler. Scans have no searchable text without OCR.
No HTML/webpages, animation, JavaScript or automatic remote fetching.
Quick Open: arrows select, Tab completes, Enter opens; Esc clears then closes.
PI_VIEW_SHORTCUT overrides Quick Open (for example: ctrl+alt+p).
Ghostty forwarding if needed: keybind = super+p=csi:112;9u
PI_VIEW_IMAGES=off forces text/path fallbacks.
Mouse support depends on the terminal; keyboard controls always work.`;

export class PreviewViewer implements Component {
  private document?: PreviewDocument;
  private abort = new AbortController();
  private closed = false;
  private loading = false;
  private message = "";
  private path: string;
  private watcher?: { path: string; listener: (current: Stats, previous: Stats) => void };
  private reloadTimer?: NodeJS.Timeout;
  private detachMouse?: () => void;
  private offset = 0;
  private matchRow?: number;
  private matchHit?: { list: SearchMatch[]; index: number };
  private horizontal = 0;
  private width = 80;
  private bodyHeight = 20;
  private totalRows = 0;
  private wrap = true;
  private numbers = readLineNumbers();
  private source = false;
  private page = 1;
  private pageWheelAt = 0;
  private pageWheelDirection = 0;
  private pdfSource?: string;
  private pdfTextLoading?: AbortController;
  private focusImage?: string;
  private zoom = 1;
  private actualSize = false;
  private panX = 0.5;
  private panY = 0.5;
  private remoteAllowed = false;
  private remotePrompt = false;
  private panel?: string;
  private layout?: { key: string; blocks: LayoutBlock[]; search?: SearchState };
  private frames = new Map<string, Frame>();
  private images = new Map<string, LoadedImage>();
  private imageJobs: Promise<unknown> = Promise.resolve();
  private requestedImages = new Set<string>();
  private visibleImages: string[] = [];
  private input = new Input();
  private inputMode?: "search" | "filter" | "page";
  private query = "";
  private filter = "";
  private picker?: { directory: string; entries: FileEntry[]; selected: number };
  private _focused = false;

  constructor(private tui: TUI, private theme: Theme, private done: () => void, path: string, initial?: "help" | "diagnostics", private onOpen?: (path: string) => void) {
    this.path = path;
    this.detachMouse = attachMouse(tui, delta => this.wheel(delta));
    this.input.onSubmit = value => this.submitInput(value);
    if (initial === "help") this.panel = HELP;
    else if (initial === "diagnostics") void this.showDiagnostics();
    else void this.open(path);
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value; this.input.focused = value && !!this.inputMode;
    if (!value) { this.detachMouse?.(); this.detachMouse = undefined; }
    else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, delta => this.wheel(delta));
  }

  private redraw(clearLayout = false): void {
    if (clearLayout) { this.layout = undefined; this.matchRow = undefined; }
    if (!this.closed) this.tui.requestRender();
  }

  invalidate(): void {
    this.layout = undefined;
    for (const frame of this.frames.values()) frame.component?.invalidate();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.stopWatching();
    clearTimeout(this.reloadTimer);
    flushLineNumbersSave();
    this.detachMouse?.(); this.detachMouse = undefined;
    this.clearFrames();
    this.images.clear();
  }

  private clearFrames(): void {
    for (const frame of this.frames.values()) { frame.abort.abort(); frame.component?.dispose(); frame.retired?.dispose(); }
    this.frames.clear();
  }

  private async open(path: string, reload = false): Promise<void> {
    clearTimeout(this.reloadTimer);
    this.abort.abort();
    const controller = this.abort = new AbortController();
    if (path !== this.path) this.stopWatching();
    this.clearFrames();
    this.images.clear();
    this.loading = true;
    this.message = "";
    if (!this.watcher) this.watchPath(path);
    if (!reload) {
      this.document = undefined; this.picker = undefined; this.panel = undefined;
      this.offset = 0; this.horizontal = 0; this.source = false; this.page = 1;
      this.query = ""; this.filter = ""; this.focusImage = undefined; this.remoteAllowed = false;
      this.resetZoom();
    }
    this.pdfSource = undefined;
    this.path = path;
    this.redraw(true);
    try {
      const info = await stat(path);
      if (controller.signal.aborted) return;
      if (info.isDirectory()) {
        this.stopWatching();
        const entries = await listDirectory(path);
        if (controller.signal.aborted) return;
        this.picker = { directory: path, entries, selected: 0 };
        if (entries.length >= MAX_LIST_ENTRIES) this.message = `Listing capped at ${MAX_LIST_ENTRIES} entries; open a specific path directly`;
        this.document = undefined;
      } else {
        const document = await loadDocument(path, controller.signal);
        if (controller.signal.aborted) return;
        this.document = document;
        this.picker = undefined;
        if (!reload) this.onOpen?.(path);
        if (document.kind === "pdf") {
          this.page = Math.min(this.page, document.pages);
          if (!capabilities().protocol) this.source = true;
        }
        if (document.kind === "image") this.images.set(path, { image: document.image });
        if (this.source && document.kind === "pdf") void this.loadPdfText();
      }
    } catch (error) {
      if (!controller.signal.aborted) this.message = safeText((error as Error).message);
    } finally {
      if (!controller.signal.aborted) { this.loading = false; this.redraw(true); }
    }
  }

  private watchPath(path: string): void {
    const listener = (): void => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => { if (!this.closed) void this.open(path, true); }, 200);
    };
    this.watcher = { path, listener };
    watchFile(path, { interval: 250 }, listener);
  }

  private stopWatching(): void {
    if (!this.watcher) return;
    unwatchFile(this.watcher.path, this.watcher.listener);
    this.watcher = undefined;
  }

  private resetZoom(): void { this.zoom = 1; this.actualSize = false; this.panX = 0.5; this.panY = 0.5; }

  private async showDiagnostics(): Promise<void> {
    const cap = capabilities();
    this.panel = ["pi-view diagnostics", "", ...cap.details, "", "Checking PDF tools…"].join("\n");
    this.offset = 0; this.clearFrames(); this.redraw(true);
    const panel = this.panel;
    const media = await mediaDiagnostics();
    if (!this.closed && this.panel === panel) {
      this.panel = ["pi-view diagnostics", "", ...cap.details, "", ...media, "", "Images: sharp, static first frame; maximum source raster 4096px/side", "HTML/webpages and animation: disabled", "Remote Markdown images: permission required", "Preview content: never added to model context", "", "b: back · Esc: close"].join("\n");
      this.redraw(true);
    }
  }

  private imageMode(): boolean {
    return !this.panel && !this.picker && (!!this.focusImage || this.document?.kind === "image" || (this.document?.kind === "pdf" && !this.source));
  }

  wheel(delta: number): void {
    if (this.closed || this.inputMode || this.remotePrompt || !delta) return;
    if (this.imageMode()) {
      if (this.document?.kind === "pdf") {
        const direction = Math.sign(delta);
        const now = performance.now();
        // Terminals can emit several wheel reports for a single notch.
        if (direction === this.pageWheelDirection && now - this.pageWheelAt < 200) return;
        this.pageWheelAt = now;
        this.pageWheelDirection = direction;
        this.setPage(this.page + direction);
      }
      return;
    }
    if (this.picker && !this.panel) this.picker.selected = Math.max(0, Math.min(this.filteredEntries().length - 1, this.picker.selected + Math.sign(delta) * 3));
    else this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset + Math.sign(delta) * 3));
    this.redraw();
  }

  private setPage(page: number): void {
    if (this.document?.kind !== "pdf") return;
    page = Math.max(1, Math.min(this.document.pages, page));
    if (page === this.page) return;
    this.page = page;
    this.resetZoom();
    this.redraw();
  }

  // Numbering applies to text/code and Markdown source rows only — never to
  // rendered Markdown, extracted PDF text, panels, the picker, or any image
  // display (the imageMode guard also absorbs a stale focused image from
  // batched input arriving between a source toggle and its repaint).
  private get numbersEligible(): boolean {
    return !this.panel && !this.picker && !this.imageMode()
      && (this.document?.kind === "text" || (this.document?.kind === "markdown" && this.source));
  }

  private toggleNumbers(): void {
    if (!this.numbersEligible) return;
    this.numbers = !this.numbers;
    queueLineNumbersSave(this.numbers);
    this.redraw(true);
  }

  handleInput(data: string): void {
    if (this.closed || isKeyRelease(data)) return;
    const raw = data;
    const key = parseKey(data);
    if (key?.length === 1) data = key;
    else if (key && /^shift\+[a-z]$/.test(key)) data = key.slice(-1).toUpperCase();
    else if (key === "shift+=") data = "+";
    else if (key === "shift+/") data = "?";
    else if (key === "space") data = " ";
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.dispose(); this.done(); return; }
    if (this.remotePrompt) {
      this.remotePrompt = false;
      if (data.toLowerCase() === "y") {
        this.remoteAllowed = true; this.images.clear(); this.clearFrames(); this.redraw(true);
      } else this.redraw();
      return;
    }
    if (this.inputMode) { this.input.handleInput(raw); this.redraw(); return; }
    if (data === "?") { this.panel = HELP; this.offset = 0; this.clearFrames(); this.redraw(true); return; }
    if (data === "d") { void this.showDiagnostics(); return; }
    if (data === "b") {
      this.panel = undefined; this.focusImage = undefined; this.offset = 0; this.resetZoom();
      if (!this.document && !this.picker) void this.open(this.path);
      this.redraw(true); return;
    }
    if (data === "r") { void this.open(this.path, true); return; }
    if (data === "o") { void this.open(this.picker?.directory ?? dirname(this.path)); return; }
    if (data === "R" && this.document?.kind === "markdown") { this.remotePrompt = true; this.redraw(); return; }
    if (data === "/") { this.startInput(this.picker && !this.panel ? "filter" : "search"); return; }
    if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      if (matchesKey(data, "enter") && entries[this.picker.selected]) void this.open(entries[this.picker.selected].path);
      else if (matchesKey(data, "backspace") || matchesKey(data, "left")) void this.open(dirname(this.picker.directory));
      else if (matchesKey(data, "up") || data === "k") this.picker.selected = Math.max(0, this.picker.selected - 1);
      else if (matchesKey(data, "down") || data === "j") this.picker.selected = Math.min(entries.length - 1, this.picker.selected + 1);
      else if (matchesKey(data, "pageUp")) this.picker.selected = Math.max(0, this.picker.selected - this.bodyHeight);
      else if (matchesKey(data, "pageDown")) this.picker.selected = Math.min(entries.length - 1, this.picker.selected + this.bodyHeight);
      this.redraw(); return;
    }
    if (data === "s" && !this.panel && (this.document?.kind === "markdown" || this.document?.kind === "pdf")) {
      this.source = !this.source; this.focusImage = undefined; this.visibleImages = []; this.offset = 0; this.clearFrames();
      if (this.source && this.document.kind === "pdf" && this.pdfSource === undefined) void this.loadPdfText();
      this.redraw(true); return;
    }
    if (this.document?.kind === "pdf" && !this.panel) {
      if (data === "g") { this.startInput("page"); return; }
      if (data === "[" || data === "]" || (this.imageMode() && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")))) {
        this.setPage(this.page + (data === "[" || matchesKey(data, "pageUp") ? -1 : 1));
        return;
      }
    }
    if (this.imageMode()) {
      if (data === "+" || data === "=") this.zoom = Math.min(32, this.zoom * 1.2);
      else if (data === "-") this.zoom = Math.max(0.05, this.zoom / 1.2);
      else if (data === "0") this.resetZoom();
      else if (data === "1") { this.zoom = 1; this.actualSize = true; }
      else if (matchesKey(data, "left") || data === "h") this.panX = Math.max(0, this.panX - 0.1);
      else if (matchesKey(data, "right") || data === "l") this.panX = Math.min(1, this.panX + 0.1);
      else if (matchesKey(data, "up") || data === "k") this.panY = Math.max(0, this.panY - 0.1);
      else if (matchesKey(data, "down") || data === "j") this.panY = Math.min(1, this.panY + 0.1);
      this.redraw(); return;
    }
    if ((matchesKey(data, "enter") || data === "i") && this.visibleImages.length) {
      this.focusImage = this.visibleImages[0]; this.resetZoom(); this.redraw(); return;
    }
    if (data === "w") { this.wrap = !this.wrap; this.horizontal = 0; this.redraw(true); return; }
    if (data === "l") { this.toggleNumbers(); return; }
    if (data === "n" || data === "N") { this.findMatch(data === "N" ? -1 : 1); return; }
    if (matchesKey(data, "up") || data === "k") this.offset--;
    else if (matchesKey(data, "down") || data === "j") this.offset++;
    else if (matchesKey(data, "pageUp")) this.offset -= this.bodyHeight;
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.bodyHeight;
    else if (matchesKey(data, "home")) this.offset = 0;
    else if (matchesKey(data, "end")) this.offset = Math.max(0, this.totalRows - this.bodyHeight);
    else if (matchesKey(data, "left")) this.horizontal = Math.max(0, this.horizontal - 8);
    else if (matchesKey(data, "right")) this.horizontal = Math.min(100_000, this.horizontal + 8);
    this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
    this.redraw();
  }

  private startInput(mode: "search" | "filter" | "page"): void {
    this.inputMode = mode; this.input.setValue(mode === "filter" ? this.filter : mode === "search" ? this.query : "");
    this.input.handleInput("\x1b[F");
    this.input.focused = this.focused; this.redraw();
  }

  private submitInput(value: string): void {
    const mode = this.inputMode;
    this.inputMode = undefined; this.input.focused = false;
    value = safeText(value).replace(/\n/g, "");
    if (mode === "filter") { this.filter = value; if (this.picker) this.picker.selected = 0; }
    if (mode === "search") { this.query = value; this.findMatch(1, true); }
    if (mode === "page" && this.document?.kind === "pdf") {
      const page = Number(value);
      if (Number.isInteger(page) && page >= 1 && page <= this.document.pages) this.setPage(page);
      else this.message = `Choose a page from 1 to ${this.document.pages}`;
    }
    this.redraw();
  }

  private async loadPdfText(): Promise<void> {
    const controller = this.abort;
    if (this.pdfTextLoading === controller) return;
    this.pdfTextLoading = controller;
    this.message = "Extracting PDF text…"; this.redraw();
    try {
      const source = await pdfText(this.path, controller.signal);
      if (controller.signal.aborted) return;
      this.pdfSource = source || "No text layer found. Scanned PDFs require OCR (not included).";
      this.message = ""; this.redraw(true);
    } catch (error) { if (!controller.signal.aborted) { this.message = safeText((error as Error).message); this.redraw(); } }
    finally { if (this.pdfTextLoading === controller) this.pdfTextLoading = undefined; }
  }

  private filteredEntries(): FileEntry[] {
    return this.picker?.entries.filter(entry => entry.name.toLowerCase().includes(this.filter.toLowerCase())) ?? [];
  }

  private textLines(text: string, width: number, code = false): { lines: string[]; units: TextUnit[] } {
    const language = this.document && getLanguageFromPath(this.document.path);
    const lines = code && text.length <= 100_000 ? highlightCode(text, language) : text.split("\n");
    const digits = String(lines.length).length;
    const numbered = this.numbersEligible && this.numbers;
    const rows: string[] = [];
    const units: TextUnit[] = [];
    for (const [index, line] of lines.entries()) {
      const prefix = numbered ? this.theme.fg("dim", `${String(index + 1).padStart(digits)} │ `) : "";
      const indent = numbered ? digits + 3 : 0;
      const contentWidth = Math.max(1, width - indent);
      const expanded = line.replace(/\t/g, "    ");
      const plain = stripVTControlCharacters(expanded);
      const wrapped = this.wrap ? wrapTextWithAnsi(expanded, contentWidth) : [expanded];
      const unit: TextUnit = { content: plain, spans: [] };
      let position = 0;
      for (const [partIndex, part] of wrapped.entries()) {
        const visible = stripVTControlCharacters(part);
        const start = plain.startsWith(visible, position) ? position
          : plain.startsWith(visible, position + 1) ? position + 1
          : Math.max(0, plain.indexOf(visible, position));
        unit.spans.push({ row: rows.length, start, end: start + visible.length });
        rows.push((partIndex === 0 ? prefix : " ".repeat(indent)) + part);
        position = start + visible.length;
      }
      units.push(unit);
    }
    return { lines: rows, units };
  }

  private getLayout(width: number): { key: string; blocks: LayoutBlock[]; search?: SearchState } {
    const key = `${width}|${this.bodyHeight}|${this.source}|${this.wrap}|${this.numbers}|${this.panel ?? ""}|${this.pdfSource ?? ""}`;
    if (this.layout?.key === key) return this.layout;
    let blocks: LayoutBlock[] = [];
    if (this.panel) blocks = [{ kind: "text", ...this.textLines(this.panel, width) }];
    else if (this.document?.kind === "markdown" && !this.source) {
      const theme = getMarkdownTheme();
      const highlight = theme.highlightCode;
      theme.highlightCode = (code, lang) => code.length <= 100_000 && highlight ? highlight(code, lang) : code.split("\n");
      const renderWidth = this.wrap ? width : Math.min(4096, this.document.source.split("\n").reduce((max, line) => Math.max(max, visibleWidth(line)), width));
      blocks = this.document.blocks.map(block => block.kind === "image"
        ? { kind: "image", target: block.target, alt: block.alt, rows: !capabilities().protocol || (!this.remoteAllowed && /^https?:\/\//i.test(block.target)) ? 1 : Math.max(2, Math.min(12, this.bodyHeight - 1)) }
        : this.markdownBlock(new Markdown(block.text, 0, 0, theme).render(renderWidth), block.text));
    } else if (this.document?.kind === "text" || this.document?.kind === "markdown") {
      blocks = [{ kind: "text", ...this.textLines(this.document.source, width, true) }];
    } else if (this.document?.kind === "pdf" && this.source) {
      blocks = [{ kind: "text", ...this.textLines(this.pdfSource ?? "Extracting text…", width) }];
    }
    this.layout = { key, blocks };
    return this.layout;
  }

  // Match source-derived text forward, preserving hard boundaries and the spaces
  // dropped by wrapping.
  // Unaligned decorations stay row-local; native span metadata would
  // allow cross-row search there without guessing or rescanning the source.
  private markdownBlock(rows: string[], source: string): LayoutBlock {
    const sourceUnits = markdownSourceUnits(source);
    const units: TextUnit[] = [];
    let unit = 0, position = 0;
    let open: TextUnit | undefined;
    let openUnit = 0, start = 0, end = 0;
    const flush = (): void => {
      if (!open) return;
      open.content = sourceUnits[openUnit].slice(start, end);
      units.push(open);
      open = undefined;
    };
    for (const [row, raw] of rows.entries()) {
      const plain = stripVTControlCharacters(raw).trim();
      if (!plain) { flush(); continue; }
      while (unit < sourceUnits.length && position >= sourceUnits[unit].length) { unit++; position = 0; }
      const sourceText = sourceUnits[unit];
      const piece = plain.replace(/^(?:[│>]\s*)+/, "").replace(/^(?:[•*+-]|\d+[.)])\s+/, "");
      const at = position + (sourceText?.[position] === " " ? 1 : 0);
      if (piece && sourceText?.startsWith(piece, at)) {
        if (open && openUnit !== unit) flush();
        if (!open) { open = { content: "", spans: [] }; openUnit = unit; start = at; }
        end = at + piece.length;
        open.spans.push({ row, start: at - start, end: end - start });
        position = end;
      } else {
        flush();
        units.push({ content: plain, spans: [{ row, start: 0, end: plain.length }] });
      }
    }
    flush();
    return { kind: "text", lines: rows, units };
  }

  private searchState(): SearchState {
    const layout = this.getLayout(this.width);
    if (!layout.search || layout.search.query !== this.query) {
      const matches: SearchMatch[] = [];
      if (this.query.trim()) {
        const pattern = new RegExp(this.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
        let cursor = 0;
        for (const block of layout.blocks) {
          const units: TextUnit[] = block.kind === "image"
            ? [{ content: `[${block.target}]`, spans: [{ row: 0, start: 0, end: block.target.length + 2 }] }]
            : block.units ?? [];
          for (const unit of units) {
            let first = 0;
            for (const hit of unit.content.matchAll(pattern)) {
              const end = hit.index + hit[0].length;
              while (first < unit.spans.length && unit.spans[first].end <= hit.index) first++;
              if (first === unit.spans.length || unit.spans[first].start >= end) continue;
              let last = first;
              while (last + 1 < unit.spans.length && unit.spans[last + 1].start < end) last++;
              const row = cursor + unit.spans[first].row;
              const endRow = cursor + unit.spans[last].row;
              // Navigation/highlighting are row-based; repeated hits on the same
              // visible range need neither another allocation nor another stop.
              const previous = matches.at(-1);
              if (!previous || previous.row !== row || previous.endRow !== endRow) matches.push({ row, endRow });
            }
          }
          cursor += block.kind === "text" ? block.lines.length : block.rows;
        }
      }
      layout.search = { query: this.query, matches };
    }
    return layout.search;
  }

  private findMatch(direction: number, includeCurrent = false): void {
    if (!this.query) return;
    const { matches } = this.searchState();
    if (!matches.length) { this.message = `No match: ${this.query}`; this.redraw(); return; }
    let index: number;
    if (!includeCurrent && this.matchHit?.list === matches) {
      index = (this.matchHit.index + direction + matches.length) % matches.length;
    } else {
      const row = this.matchRow ?? this.offset;
      index = direction > 0
        ? matches.findIndex(match => includeCurrent ? match.row >= row : match.row > row)
        : matches.findLastIndex(match => match.row < row);
      if (index === -1) index = direction > 0 ? 0 : matches.length - 1;
    }
    const match = matches[index];
    this.matchHit = { list: matches, index };
    this.matchRow = match.row; this.offset = match.row; this.message = ""; this.redraw();
  }

  private getImage(target: string): Promise<ImageSource> {
    let entry = this.images.get(target);
    if (entry?.image) return Promise.resolve(entry.image);
    if (entry?.error) return Promise.reject(new Error(entry.error));
    if (entry?.promise) return entry.promise;
    entry = { abort: new AbortController() };
    this.images.set(target, entry);
    const source = entry;
    const signal = AbortSignal.any([this.abort.signal, entry.abort!.signal]);
    const path = this.path;
    const page = this.document?.kind === "pdf" ? this.page : undefined;
    const allowRemote = this.remoteAllowed;
    const promise = this.imageJobs.then(() => {
      signal.throwIfAborted();
      return page !== undefined && target === `pdf:${page}`
        ? loadPdfPage(path, page, signal)
        : loadImage(target, dirname(path), allowRemote, signal);
    });
    source.promise = promise.then(image => {
      source.image = image; source.promise = undefined;
      // At most one source decoder runs, and only four decoded images are retained.
      const completed = [...this.images].filter(([, entry]) => entry.image);
      for (const [key] of completed.slice(0, Math.max(0, completed.length - 4))) this.images.delete(key);
      return image;
    }, error => { source.error = safeText((error as Error).message); source.promise = undefined; throw error; });
    this.imageJobs = source.promise.catch(() => {});
    return source.promise;
  }

  private imageLines(target: string, width: number, fullRows: number, top: number, rows: number, focused: boolean, used: Set<string>): string[] {
    this.requestedImages.add(target);
    const cap = capabilities();
    const label = safeText(target.startsWith("data:") ? "embedded image" : target).replace(/[\n\t]/g, " ");
    if (!cap.protocol || width < 5) return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}] — terminal images unavailable; d: diagnostics`), width), ...Array(rows - 1).fill("")];
    const key = [target, width, fullRows, top, rows, cap.protocol, cap.cellWidth, cap.cellHeight, focused].join("|");
    const transform = focused ? `${this.zoom}|${this.actualSize}|${this.panX}|${this.panY}` : "fit";
    used.add(key);
    let frame = this.frames.get(key);
    if (!frame) {
      frame = { abort: new AbortController() };
      this.frames.set(key, frame);
    }
    // One active render per slot. Keep its last pixels visible and pick up the
    // latest transform on completion instead of killing/restarting the worker.
    if (frame.rendered !== transform && !frame.pending) {
      const current = frame;
      if (this.message === current.error) this.message = "";
      current.error = undefined;
      current.pending = transform;
      const signal = AbortSignal.any([this.abort.signal, current.abort.signal]);
      const options = {
        widthPx: Math.max(1, Math.floor((width - 2) * cap.cellWidth)), heightPx: Math.max(1, Math.floor(fullRows * cap.cellHeight)),
        zoom: focused ? this.zoom : 1, actualSize: focused && this.actualSize,
        panX: focused ? this.panX : 0.5, panY: focused ? this.panY : 0.5,
        cropTopPx: Math.floor(top * cap.cellHeight), cropHeightPx: Math.max(1, Math.floor(rows * cap.cellHeight)),
      };
      void this.getImage(target).then(image => renderRaster(image, options, signal)).then(png => {
        if (signal.aborted || this.closed) return;
        const component = createTerminalImage(png, width - 2, rows, label, this.tui);
        current.retired = current.component;
        current.component = component;
        current.rendered = transform;
      }).catch(error => {
        if (!signal.aborted && !this.closed) {
          current.error = safeText((error as Error).message);
          current.rendered = transform;
          this.message = current.error;
        }
      }).finally(() => {
        current.pending = undefined;
        if (!signal.aborted) this.redraw();
      });
    }
    if (frame.component) {
      const lines = frame.component.render(width);
      if (frame.retired) {
        const retired = frame.retired;
        frame.retired = undefined;
        // The host writes this synchronous render's replacement before the
        // microtask removes the old, independently owned image placement.
        queueMicrotask(() => retired.dispose());
      }
      return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill("")];
    }
    const status = frame.error ? ` — ${frame.error}` : " — loading…";
    return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}]${status}`.replace(/[\n\t]/g, " ")), width), ...Array(rows - 1).fill("")];
  }

  render(width: number): string[] {
    width = Math.max(1, width);
    if (this.tui.terminal.rows < 6) return [truncateToWidth("pi-view · enlarge terminal · Esc: close", width)];
    this.requestedImages.clear();
    this.width = Math.max(1, width);
    this.bodyHeight = Math.max(1, this.tui.terminal.rows - 5);
    const used = new Set<string>();
    let body: string[] = [];
    this.visibleImages = [];
    const document = this.document;
    let title = this.picker ? this.picker.directory : this.path;
    if (this.panel) title = "pi-view";
    if (this.loading) body = ["Loading…"];
    else if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      const start = Math.max(0, this.picker.selected - this.bodyHeight + 1);
      body = entries.slice(start, start + this.bodyHeight).map((entry, i) => {
        const line = `${start + i === this.picker!.selected ? ">" : " "} ${safeText(entry.name).replace(/[\n\t]/g, " ")}${entry.directory ? "/" : ""}`;
        return truncateToWidth(start + i === this.picker!.selected ? this.theme.fg("accent", line) : line, width);
      });
      if (!entries.length) body = [truncateToWidth(this.filter ? "No matching files; / changes filter" : "Empty directory; Backspace goes to parent", width)];
      title += this.filter ? ` · filter: ${this.filter}` : "";
    } else if (this.imageMode()) {
      const target = this.focusImage ?? (document?.kind === "pdf" ? `pdf:${this.page}` : this.path);
      body = this.imageLines(target, width, this.bodyHeight, 0, this.bodyHeight, true, used);
      title += ` · ${this.actualSize ? "actual" : "fit"} ×${this.zoom.toFixed(2)}`;
      if (document?.kind === "pdf") title += ` · page ${this.page}/${document.pages}`;
    } else {
      const { blocks } = this.getLayout(width);
      this.totalRows = blocks.reduce((sum, block) => sum + (block.kind === "text" ? block.lines.length : block.rows), 0);
      this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
      const highlighted = new Set<number>();
      if (this.query) {
        for (const match of this.searchState().matches) {
          for (let row = match.row; row <= match.endRow; row++) highlighted.add(row);
        }
      }
      let cursor = 0;
      for (const block of blocks) {
        const count = block.kind === "text" ? block.lines.length : block.rows;
        const start = Math.max(0, this.offset - cursor);
        const end = Math.min(count, this.offset + this.bodyHeight - cursor);
        if (end > start) {
          if (block.kind === "image") {
            this.visibleImages.push(block.target);
            body.push(...this.imageLines(block.target, width, count, start, end - start, false, used));
          } else {
            body.push(...block.lines.slice(start, end).map((line, i) => {
              let shown = this.wrap ? truncateToWidth(line, width, "") : sliceByColumn(line, this.horizontal, width);
              if (highlighted.has(cursor + start + i)) shown = this.theme.bg("selectedBg", shown);
              return shown;
            }));
          }
        }
        cursor += count;
        if (cursor >= this.offset + this.bodyHeight) break;
      }
      if (this.totalRows) title += ` · ${this.offset + 1}/${this.totalRows}${this.source ? " · source" : ""}`;
      if (this.query && this.matchRow !== undefined) title += ` · match ${this.matchRow + 1}`;
    }
    for (const [key, frame] of this.frames) if (!used.has(key)) { frame.abort.abort(); frame.component?.dispose(); frame.retired?.dispose(); this.frames.delete(key); }
    for (const [target, source] of this.images) {
      if (source.promise && !this.requestedImages.has(target)) { source.abort?.abort(); this.images.delete(target); }
    }
    body.push(...Array(Math.max(0, this.bodyHeight - body.length)).fill(""));
    let status = this.remotePrompt ? "Fetch remote Markdown images? Requests may reveal your IP. y: allow · any other key: deny"
      : this.message || (this.imageMode() ? `+/-: zoom · arrows: pan${document?.kind === "pdf" ? " · wheel: pages" : ""} · 0: fit · 1: actual · b: back · Esc: close`
      : this.picker && !this.panel ? "↑↓: choose · Enter: open · Backspace: parent · /: filter · Esc: close"
      : "↑↓ wheel: scroll · /: search · n/N: matches · s: source/text · i: image · ?: help · Esc: close");
    if (this.inputMode) status = `${this.inputMode}: ${this.input.render(Math.max(1, width - this.inputMode.length - 2))[0] ?? ""}`;
    return [this.theme.fg("accent", truncateToWidth(safeText(title).replace(/[\n\t]/g, " "), width)), this.theme.fg("borderMuted", "─".repeat(width)),
      ...body.slice(0, this.bodyHeight), this.theme.fg("borderMuted", "─".repeat(width)), truncateToWidth(status.replace(/[\n\t]/g, " "), width)];
  }
}
