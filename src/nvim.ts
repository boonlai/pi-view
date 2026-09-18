/**
 * Embedded Neovim editing for pi-view previews.
 *
 * Launches the user's native `nvim --embed` over child-process pipes (no
 * shell, no PTY, no --headless), attaches a single-grid ext_linegrid UI, and
 * speaks documented msgpack-rpc with @msgpack/msgpack handling the wire
 * format. Isolation rides in argv: `-u NONE -i NONE --noplugin` plus a
 * static single-line `--cmd` Lua chunk — no user config, plugins, shada or
 * modelines. Swap files stay enabled in Neovim's state directory to support
 * its native recovery mechanism after a forced teardown.
 *
 * Input routing: host key data is parsed (legacy and Kitty sequences) and
 * re-encoded as Neovim key notation for nvim_input — nvim_input interprets
 * `<...>` notation, so literal "<" is escaped as <LT> and typed "<Esc>" stays
 * text. Bracketed paste is buffered to its end marker and delivered as
 * literal text through nvim_paste. Keys and paste share one FIFO so Neovim
 * sees them in arrival order. Esc and Ctrl-C belong to Neovim while the
 * session runs. Exit is detected via a VimLeavePre rpcnotify and the
 * child-process close event: the session finalizes only after stdout has
 * drained, so a normal quit is never misclassified as a crash.
 */

import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { Readable } from "node:stream";
import { dirname, resolve as resolvePath } from "node:path";
import { getCapabilities, parseKey } from "@earendil-works/pi-tui";
import { DecodeError, decodeMultiStream, encode } from "@msgpack/msgpack";
import { NvimGrid } from "./nvim-grid.ts";
import { safeText } from "./documents.ts";

/** Oldest Neovim with nvim_create_autocmd, exec_lua and stable linegrid UI. */
const MINIMUM_VERSION = 0 * 10_000 + 9 * 100 + 0;

export interface NvimEditorOptions {
  cols: number;
  rows: number;
  /** Session is attached and ready for input. */
  onReady(): void;
  /** Grid content or mode changed; the viewer should schedule a render. */
  onFlush(): void;
  /** Startup or protocol failure; the editor is finished and the preview intact. */
  onError(message: string): void;
  /** The user quit Neovim ("quit") or it died unexpectedly ("crashed"). */
  onExit(reason: "quit" | "crashed", detail?: string): void;
  /** Dirty tracking changed (any listed, modified file buffer). */
  onDirty?(dirty: boolean): void;
}

/** Consumer contract the preview codes against; NvimEditor is the only implementation. */
export interface NvimEditingSession {
  readonly dirty: boolean;
  readonly running: boolean;
  /** Launch Neovim; failures arrive through the editor's own callbacks. */
  start(): void;
  input(data: string): void;
  wheel(delta: number): void;
  resize(cols: number, rows: number): void;
  render(focused: boolean): { rows: string[]; mode: string };
  dispose(): void;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const MOUSE_PACKET = /^\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[MIDO]/;

// pi-tui KeyId base names → Neovim key notation inside <...>.
const NOTATION_BY_KEY: Record<string, string> = {
  escape: "Esc", enter: "CR", return: "CR", tab: "Tab", backspace: "BS", delete: "Del",
  insert: "Insert", home: "Home", end: "End", pageUp: "PageUp", pageDown: "PageDown",
  up: "Up", down: "Down", left: "Left", right: "Right", clear: "Clear",
  f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
  f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",
};

// Modifier name in a KeyId → Neovim modifier prefix.
const NOTATION_BY_MODIFIER: Record<string, string> = { ctrl: "C", alt: "M", meta: "M", super: "D", shift: "S" };

type QueueItem = { kind: "keys"; bytes: Buffer } | { kind: "paste"; text: string };

// Static isolated setup as one single-line semicolon-joined Lua chunk,
// executed before any config would load: no user init/plugins/shada/
// modelines, built-in runtime only, built-in filetype and syntax machinery
// on. Swap handling stays at the Neovim default (state dir, swapfile on,
// updatecount 200): a forced teardown leaves recoverable state exactly
// where native Neovim looks for it. Static argv only — nothing interpolated.
const LUA_SETUP = [
  "vim.o.modeline = false",
  "vim.o.loadplugins = false",
  'vim.o.shadafile = "NONE"',
  "vim.o.undofile = false",
  "local runtime = vim.env.VIMRUNTIME; if runtime and #runtime > 0 then vim.opt.runtimepath = { runtime } end",
  'vim.cmd("filetype plugin indent on")',
  'vim.cmd("syntax on")',
].join("; ");

// Registered before ui_attach via nvim_exec_lua (the early-init window
// accepts regular RPC while startup is paused): push-based dirty tracking so
// the viewer can show state without an RPC round-trip, plus an exit ping.
// The channel id comes from the initial api_info response — inside Lua
// vim.api.nvim_get_api_info is unavailable. Neovim's own swap-recovery
// prompt is the user-visible recovery path after a forced teardown;
// pi-view never writes the real file itself.
const REGISTER_LUA = `local channel = ...
local function report()
  local dirty = false
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    if vim.bo[buffer].modified and vim.bo[buffer].buftype == "" and vim.bo[buffer].buflisted then
      dirty = true
      break
    end
  end
  vim.rpcnotify(channel, "pi_view_dirty", dirty)
end
vim.api.nvim_create_autocmd(
  { "TextChanged", "TextChangedI", "TextChangedP", "TextChangedT", "BufModifiedSet", "BufWritePre", "BufWritePost", "BufNew", "BufReadPost" },
  { callback = report })
report()
vim.api.nvim_create_autocmd("VimLeavePre", {
  callback = function() vim.rpcnotify(channel, "pi_view_exit") end,
})`;

export class NvimEditor implements NvimEditingSession {
  private grid: NvimGrid;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private child?: ChildProcess;
  private nextId = 1;
  private stderrTail = "";
  private readyTimer?: NodeJS.Timeout;
  private pasteTimer?: NodeJS.Timeout;
  private killTimer?: NodeJS.Timeout;
  private pasteBuffer?: string;
  private inputQueue: QueueItem[] = [];
  private pumping = false;
  private desired: { cols: number; rows: number };
  private sent = { cols: 0, rows: 0 };
  private drawing = false;
  private mode = "";
  private _dirty = false;
  private userExit = false;
  private finished = false;
  private launched = false;

  constructor(private path: string, private options: NvimEditorOptions, private spawnChild: SpawnFn = spawn) {
    this.path = resolvePath(path);
    this.desired = { cols: Math.max(4, options.cols), rows: Math.max(2, options.rows) };
    this.grid = new NvimGrid(getCapabilities().trueColor);
  }

  get dirty(): boolean { return this._dirty; }
  get running(): boolean { return !this.finished; }
  // True once Neovim started drawing: input is live and the grid renders,
  // including native startup prompts such as swap recovery.
  get ready(): boolean { return this.drawing && !this.finished; }

  /** Launch Neovim and attach. Failures surface via onError; never throws. */
  start(): void {
    if (this.launched || this.finished) return;
    this.launched = true;
    try {
      // Static setup rides in argv as one verified single-line Lua chunk:
      // no temp files, no read-lifetime races, nothing user-controlled
      // interpolated through a shell.
      // The file argument after `--` avoids command-line parsing of odd
      // names; relative editor commands run from the file's directory.
      const child = this.spawnChild("nvim",
        ["--embed", "-u", "NONE", "-i", "NONE", "--noplugin", "--cmd", `lua ${LUA_SETUP}`, "--", this.path],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, cwd: dirname(this.path) });
      this.child = child;
      // A dead child turns its pipes into EPIPE sources; without listeners
      // those become unhandled stream errors in the host. Request-level
      // write callbacks still fail cleanly, keeping the preview alive for
      // a retry, while the close/error events tell the story.
      child.stdin?.on("error", () => {});
      child.stderr?.on("error", () => {});
      this.readStream(child.stdout!);
      child.stderr?.on("data", (chunk: Buffer) => this.rememberStderr(chunk));
      child.on("error", (error: NodeJS.ErrnoException) => {
        this.fail(error.code === "ENOENT"
          ? "Neovim is not installed or not on PATH; install nvim (>= 0.9) to edit previews"
          : `Could not launch Neovim: ${safeText(error.message)}`);
      });
      // Finalize on "close", not "exit": the final VimLeavePre notify can
      // still sit in stdout when the process dies, and finalizing early
      // would misclassify a normal :q as a crash.
      child.on("close", (code, signal) => this.onSessionEnd(code, signal));
      this.readyTimer = setTimeout(() => this.fail("Neovim did not start drawing within 10 seconds"), 10_000);
      this.readyTimer.unref();
      void this.handshake().catch(error => this.fail(error instanceof Error ? error.message : String(error)));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private async handshake(): Promise<void> {
    const info = await this.request("nvim_get_api_info", []);
    this.checkVersion(info);
    // The channel id rides on the initial api_info response; later Lua
    // cannot fetch it (vim.api.nvim_get_api_info is unavailable there).
    const channel = Array.isArray(info) && typeof info[0] === "number" ? info[0] : undefined;
    if (channel === undefined || !Number.isSafeInteger(channel) || channel < 1) throw new Error("Neovim did not report a usable RPC channel");
    // Register dirty/exit hooks BEFORE attach: startup is still paused,
    // regular RPC is processed in that window, so registration cannot be
    // starved by native prompts and the very first edits are tracked.
    await this.request("nvim_exec_lua", [REGISTER_LUA, [channel]]);
    await this.attach();
    // After attach Neovim may draw and block on native startup prompts
    // (swap recovery, read errors). The first redraw flips the drawing
    // flag, cancels this guard and shows the real screen — a live prompt
    // is never killed by a handshake timeout.
  }

  input(data: string): void {
    if (this.finished || !data) return;
    // Assembly mode: chunks belong to the current bracketed paste until its
    // end marker shows up.
    if (this.pasteBuffer !== undefined) {
      this.pasteBuffer += data;
      this.settlePaste();
      return;
    }
    const start = data.indexOf(PASTE_START);
    if (start < 0) { this.enqueue(translateKeys(data)); return; }
    const before = data.slice(0, start);
    if (before) this.enqueue(translateKeys(before));
    this.pasteBuffer = data.slice(start + PASTE_START.length);
    this.settlePaste();
  }

  wheel(delta: number): void {
    if (this.finished || !delta) return;
    const notches = Math.min(3, Math.max(1, Math.round(Math.abs(delta) / 3)));
    this.enqueue((delta > 0 ? "<ScrollWheelDown>" : "<ScrollWheelUp>").repeat(notches));
  }

  resize(cols: number, rows: number): void {
    const next = { cols: Math.max(4, cols), rows: Math.max(2, rows) };
    if (next.cols === this.desired.cols && next.rows === this.desired.rows) return;
    this.desired = next;
    this.applyResize();
  }

  render(focused: boolean): { rows: string[]; mode: string } {
    // Until the first draw the grid is empty; the preview frames the blank
    // body with its own starting message.
    const rows = this.drawing && !this.finished ? this.grid.render(focused) : [];
    return { rows, mode: this.mode };
  }

  dispose(): void {
    if (this.finished) return;
    const child = this.child;
    if (!child) { this.finishLocally(); return; }
    // Anything the user typed but that is still queued must reach Neovim
    // before the preserve, or recovery would miss it. Frames go straight to
    // the pipe in order; responses are deliberately not awaited.
    this.flushQueueTo(child);
    // Unsaved content: attempt a swap preserve so the buffer stays recoverable
    // through Neovim's own swap prompt (`nvim -r`); never the real file. The
    // request is sent before the session closes, then bounded kills follow.
    if (this._dirty) {
      void this.request("nvim_command", ["silent! preserve"]).catch(() => {});
      this.finishLocally();
      this.killTimer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        this.killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 250);
        this.killTimer.unref();
      }, 150);
      this.killTimer.unref();
    } else {
      this.finishLocally();
      try { child.kill("SIGTERM"); } catch {}
      this.killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 300);
      this.killTimer.unref();
    }
    child.once("exit", () => clearTimeout(this.killTimer));
  }

  /** Close out client state once the child-facing teardown is arranged. */
  private finishLocally(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.rejectAll(new Error("Neovim session closed"));
    this.pasteBuffer = undefined;
  }

  private flushQueueTo(child: ChildProcess): void {
    const items = this.inputQueue;
    this.inputQueue = [];
    for (const item of items) {
      const params = item.kind === "paste"
        ? [item.text, true, -1]
        : [item.bytes.toString("utf8")];
      try { child.stdin?.write(encode([0, this.nextId++, item.kind === "paste" ? "nvim_paste" : "nvim_input", params])); } catch {}
    }
  }

  /** Consume the msgpack-rpc stream through the maintained codec. */
  private readStream(stdout: Readable): void {
    void (async () => {
      try {
        const chunks = async function* (stream: Readable): AsyncGenerator<Uint8Array> {
          for await (const chunk of stream) yield chunk as Buffer;
        };
        for await (const message of decodeMultiStream(chunks(stdout))) {
          this.dispatch(message);
        }
        // Stream ended: the close event provides the narrative.
      } catch (error) {
        if (error instanceof DecodeError && !this.finished) {
          this.fail(`Neovim sent an invalid RPC stream: ${safeText(error.message)}`);
        }
        // Incomplete frames (RangeError) mean the process died mid-frame;
        // onSessionEnd reports that with exit code and stderr context.
      }
    })();
  }

  private dispatch(message: unknown): void {
    if (!Array.isArray(message) || message.length === 0) return;
    switch (message[0]) {
      case 1: { // response: [1, id, error, result]
        const id = message[1];
        const waiter = typeof id === "number" ? this.pending.get(id) : undefined;
        if (waiter) {
          this.pending.delete(id);
          if (message[2] !== null && message[2] !== undefined) waiter.reject(new Error(describe(message[2])));
          else waiter.resolve(message[3]);
        }
        return;
      }
      case 2: { // notification: [2, method, params]
        const [method, params] = [message[1], message[2]];
        if (method === "redraw" && Array.isArray(params)) { this.markDrawing(); this.handleRedraw(params); }
        else if (method === "pi_view_dirty") this.setDirty(params?.[0] === true);
        else if (method === "pi_view_exit") this.userExit = true;
        return;
      }
      default: return; // requests aimed at us would be a Neovim-side bug; ignore
    }
  }

  private handleRedraw(groups: unknown[]): void {
    for (const group of groups) {
      if (!Array.isArray(group) || typeof group[0] !== "string") continue;
      const name = group[0];
      const tuples = group.slice(1);
      if (name === "flush") { this.options.onFlush(); continue; }
      if (name === "mode_change") {
        const mode = Array.isArray(tuples[0]) ? tuples[0][0] : undefined;
        if (typeof mode === "string" && mode !== this.mode) { this.mode = mode; this.options.onFlush(); }
        continue;
      }
      if (name === "busy_start") { this.grid.busy = true; continue; }
      if (name === "busy_stop") { this.grid.busy = false; this.options.onFlush(); continue; }
      for (const tuple of tuples) {
        if (Array.isArray(tuple)) this.grid.handle(name, tuple);
      }
    }
  }

  private request(method: string, params: unknown[]): Promise<unknown> {
    const child = this.child;
    if (this.finished || !child) return Promise.reject(new Error("Neovim session closed"));
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(id, { resolve, reject });
    const frame = encode([0, id, method, params]);
    child.stdin?.write(frame, error => {
      if (error) {
        this.pending.delete(id);
        reject(new Error(`Could not write to Neovim: ${safeText(error.message)}`));
      }
    });
    return promise;
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private setDirty(dirty: boolean): void {
    if (dirty === this._dirty) return;
    this._dirty = dirty;
    this.options.onDirty?.(dirty);
  }

  /** Queue notation or paste text; one FIFO keeps Neovim's input ordered. */
  private enqueue(notation: string): void {
    if (!notation) return;
    this.inputQueue.push({ kind: "keys", bytes: Buffer.from(notation, "utf8") });
    void this.pumpInput();
  }

  /** nvim_input may accept fewer bytes than queued; pump until drained. */
  private async pumpInput(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.inputQueue.length > 0) {
        if (this.finished) { this.inputQueue.length = 0; return; }
        if (!this.child) { await delay(10); continue; }
        const item = this.inputQueue[0];
        if (item.kind === "paste") {
          // Neovim handles CR/CRLF; NUL bytes are valid paste data too.
          this.inputQueue.shift();
          if (item.text) await this.request("nvim_paste", [item.text, true, -1]).catch(() => {});
          continue;
        }
        let written: unknown;
        try {
          written = await this.request("nvim_input", [item.bytes.toString("utf8")]);
        } catch {
          this.inputQueue.length = 0;
          return;
        }
        const consumed = typeof written === "number" ? written : item.bytes.length;
        if (consumed >= item.bytes.length) {
          this.inputQueue.shift();
        } else if (consumed > 0) {
          this.inputQueue[0] = { kind: "keys", bytes: item.bytes.subarray(consumed) };
        } else {
          await delay(5);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Complete a bracketed paste at the end marker; flush stuck pastes late. */
  private settlePaste(): void {
    const end = this.pasteBuffer?.indexOf(PASTE_END) ?? -1;
    if (end < 0) {
      this.pasteTimer ??= setTimeout(() => {
        const stuck = this.pasteBuffer;
        this.pasteBuffer = undefined;
        this.pasteTimer = undefined;
        if (stuck) { this.inputQueue.push({ kind: "paste", text: stuck }); void this.pumpInput(); }
      }, 3_000);
      this.pasteTimer.unref();
      return;
    }
    const payload = this.pasteBuffer!.slice(0, end);
    const tail = this.pasteBuffer!.slice(end + PASTE_END.length);
    this.pasteBuffer = undefined;
    clearTimeout(this.pasteTimer);
    this.pasteTimer = undefined;
    if (payload) { this.inputQueue.push({ kind: "paste", text: payload }); void this.pumpInput(); }
    if (tail) this.enqueue(translateKeys(tail));
  }

  private applyResize(): void {
    if (!this.drawing || this.finished) return;
    if (this.desired.cols === this.sent.cols && this.desired.rows === this.sent.rows) return;
    const { cols, rows } = this.desired;
    void this.request("nvim_ui_try_resize", [cols, rows]).then(() => {
      this.sent = { cols, rows };
    }).catch(() => {});
  }

  private async attach(): Promise<void> {
    const { cols, rows } = this.desired;
    await this.request("nvim_ui_attach", [cols, rows, { rgb: true, ext_linegrid: true }]);
    this.sent = { cols, rows };
  }

  private checkVersion(info: unknown): void {
    const metadata = Array.isArray(info) ? info[1] : undefined;
    const version = (metadata as { version?: { major?: unknown; minor?: unknown; patch?: unknown } } | undefined)?.version;
    const major = version?.major, minor = version?.minor, patch = version?.patch;
    if (typeof major !== "number" || typeof minor !== "number" || typeof patch !== "number") {
      throw new Error("Neovim did not report a recognizable API version");
    }
    if (major * 10_000 + minor * 100 + patch < MINIMUM_VERSION) {
      throw new Error(`Neovim ${major}.${minor}.${patch} is too old; pi-view editing needs nvim >= 0.9 on PATH`);
    }
  }

  private rememberStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-500);
  }

  private onSessionEnd(code: number | null, signal: string | null): void {
    if (this.finished) return;
    if (!this.drawing && !this.userExit) {
      const detail = this.stderrTail.trim();
      const cause = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.fail(`Neovim exited during startup (${cause})${detail ? `: ${detail}` : ""}`);
      return;
    }
    this.finishLocally();
    if (this.userExit) this.options.onExit("quit");
    else {
      const detail = signal ? `Neovim terminated by signal ${signal}` : `Neovim exited with code ${code ?? "unknown"}`;
      this.options.onExit("crashed", detail);
    }
  }

  /** First screen output: the session is interactive, so stand down the guard. */
  private markDrawing(): void {
    if (this.drawing) return;
    this.drawing = true;
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.options.onReady();
  }

  /** Terminal failure: report an actionable message, keep the preview alive. */
  private fail(message: string): void {
    const firstFailure = !this.finished;
    this.finished = true;
    this.clearTimers();
    this.rejectAll(new Error(message));
    this.pasteBuffer = undefined;
    // Ensure no spawn survives a failure path, even a late one.
    try { this.child?.kill("SIGKILL"); } catch {}
    if (firstFailure) this.options.onError(safeText(message));
  }

  private clearTimers(): void {
    clearTimeout(this.readyTimer);
    clearTimeout(this.pasteTimer);
    clearTimeout(this.killTimer);
    this.readyTimer = undefined; this.pasteTimer = undefined; this.killTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Host input → Neovim key notation
// ---------------------------------------------------------------------------

/**
 * Encode host input for nvim_input. Recognized sequences (legacy and Kitty,
 * via pi-tui's parser) become notation like <Up>/<C-S>/<Esc>; everything else
 * is treated as literal text with "<" escaped as <LT>, so typed "<Esc>"
 * inserts text instead of pressing Escape. Mouse packets never belong to the
 * keyboard stream and are dropped.
 */
function translateKeys(data: string): string {
  if (!data || MOUSE_PACKET.test(data)) return "";
  const key = parseKey(data);
  if (key !== undefined) return notationFor(key);
  return literalNotation(data);
}

function notationFor(keyId: string): string {
  const modifiers = keyId.split("+");
  const base = modifiers.pop() ?? "";
  if (modifiers.length === 0) {
    if (base === "space") return " ";
    if (base.length === 1) return base === "<" ? "<LT>" : base;
    const named = NOTATION_BY_KEY[base];
    return named ? `<${named}>` : "";
  }
  let inner = NOTATION_BY_KEY[base];
  if (!inner) {
    if (base.length !== 1) return "";
    // Shifted letters and symbols are their own characters when shift is the
    // only modifier; combined modifiers keep the uppercased base.
    if (modifiers.length === 1 && modifiers[0] === "shift") return base === "<" ? "<LT>" : base.toUpperCase();
    inner = base.toUpperCase();
  }
  const prefix = modifiers.map(modifier => NOTATION_BY_MODIFIER[modifier] ?? modifier.toUpperCase()).join("-");
  return `<${prefix}-${inner}>`;
}

function literalNotation(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "<") { out += "<LT>"; continue; }
    if (char === "\r" || char === "\n") { out += "<CR>"; continue; }
    if (char === "\t") { out += "<Tab>"; continue; }
    if (char === "\x1b") { out += "<Esc>"; continue; }
    if (char === "\x7f") { out += "<BS>"; continue; }
    const code = char.charCodeAt(0);
    if (code === 0) { out += "<C-@>"; continue; }
    if (code <= 0x1f && char.length === 1) {
      // Legacy control bytes (C0) keep their C-x meaning.
      out += `<C-${String.fromCharCode(0x40 + code)}>`;
      continue;
    }
    out += char;
  }
  return out;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  timer.unref();
  return promise;
}

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join(": ");
  if (value === null || value === undefined) return "";
  return safeText(String(value));
}
