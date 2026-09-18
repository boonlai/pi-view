/**
 * Capability-driven inline image rendering and scoped mouse-wheel capture for
 * Pi and Oh My Pi (OMP).
 *
 * Both hosts expose the `@earendil-works/pi-tui` API surface; OMP rewrites the
 * import to its bundled copy. Everything in this module goes through that
 * surface so the same code runs on either host:
 * - `Image` supplies host-native layout and encoding. Anonymous Kitty
 *   transmissions are tagged so every preview has an independently owned ID.
 * - Disposal deletes only the IDs owned by this module.
 * - Wheel capture uses the raw TUI input listener hook present on both hosts;
 *   plain keyboard data always passes through.
 *
 * Global host capability state is only ever read, never mutated.
 */
import { randomInt } from "node:crypto";
import * as piTui from "@earendil-works/pi-tui";

import type { TUI } from "@earendil-works/pi-tui";
const {
  Image,
  allocateImageId,
  deleteKittyImage,
  getCapabilities,
  getCellDimensions,
  getImageDimensions,
} = piTui;

type TuiInputListener = (data: string) => { consume?: boolean; data?: string } | undefined;

/** OMP-only runtime terminal object (upstream pi-tui does not export it). */
interface OmpTerminal {
  imageProtocol?: string | null;
}

/** Kitty graphics marker used by OMP's `TERMINAL.imageProtocol`. */
const SIXEL_IMAGE_PROTOCOL = "\x1BPq";
/** Host image-protocol markers mirrored by OMP's runtime object. */
const KITTY_IMAGE_PROTOCOL = "\x1B_G";
const ITERM2_IMAGE_PROTOCOL = "\x1B]1337;File=";

/** Read-only access to the OMP host terminal object; undefined on upstream Pi. */
function ompTerminal(): OmpTerminal | undefined {
  return (piTui as typeof piTui & { TERMINAL?: OmpTerminal }).TERMINAL;
}

/** True under the OMP host, whose overlay close path differs from upstream Pi. */
export function isOmpHost(): boolean {
  return ompTerminal() !== undefined;
}

function hostImageProtocol(): string | null | undefined {
  return ompTerminal()?.imageProtocol;
}

function mapHostImageProtocol(marker: string | null | undefined): string | null {
  if (marker === KITTY_IMAGE_PROTOCOL) return "kitty";
  if (marker === ITERM2_IMAGE_PROTOCOL) return "iterm2";
  if (marker === SIXEL_IMAGE_PROTOCOL) return "sixel";
  return null;
}

export interface HostCapabilities {
  /** "kitty" | "iterm2" | "sixel" | null (null = text fallback). */
  protocol: string | null;
  cellWidth: number;
  cellHeight: number;
  /** Human-readable diagnostics: host, protocol, terminal, multiplexer. */
  details: string[];
}

export interface TerminalImage {
  /** Kitty image ID owned by this image, when one was allocated. */
  readonly imageId: number | undefined;
  /** Expected geometry in cells for the rendered image. */
  readonly columns: number;
  readonly rows: number;
  /** Lines for the TUI at the given width; escape sequences pass through untouched. */
  render(width: number): string[];
  /** Drop cached rendered lines (e.g. after a resize). */
  invalidate(): void;
  /** Release resources; idempotent. Deletes only this image's kitty ID. */
  dispose(): void;
}

function imagesDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.PI_VIEW_IMAGES?.trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}

function detectTerminalName(env: NodeJS.ProcessEnv): string {
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = env.TERM?.toLowerCase() ?? "";
  if (env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (env.ALACRITTY_WINDOW_ID || termProgram === "alacritty") return "alacritty";
  if (env.VSCODE_PID || termProgram === "vscode") return "vscode";
  if (termProgram === "warpterminal" || env.WARP_SESSION_ID || env.WARP_TERMINAL_SESSION_UUID) return "warp";
  if (env.WT_SESSION) return "windows-terminal";
  if (termProgram === "apple_terminal") return "terminal.app";
  if (env.TERMINAL_EMULATOR === "jetbrains-jediterm") return "jetbrains";
  return env.TERM || "unknown";
}

function detectMultiplexer(env: NodeJS.ProcessEnv): string {
  if (env.TMUX) return "tmux";
  if (env.STY) return "screen";
  if (env.ZELLIJ) return "zellij";
  return "none";
}

/**
 * Resolve the image protocol without mutating any host state.
 * `hostProtocolMarker` is injectable for tests; production reads the OMP
 * runtime object (Sixel capable) and falls back to the shared pi-tui
 * capability detection (kitty/iTerm2 only).
 */
export function resolveImageProtocol(
  env: NodeJS.ProcessEnv,
  hostProtocolMarker?: string | null,
): { protocol: string | null; detail: string } {
  if (imagesDisabled(env)) {
    return { protocol: null, detail: `images: disabled (PI_VIEW_IMAGES=${env.PI_VIEW_IMAGES})` };
  }
  const marker = hostProtocolMarker === undefined ? hostImageProtocol() : hostProtocolMarker;
  if (marker === SIXEL_IMAGE_PROTOCOL) {
    return { protocol: "sixel", detail: "protocol: sixel (host-reported)" };
  }
  if (env.PI_FORCE_IMAGE_PROTOCOL?.trim() && marker !== undefined) {
    // Host has an explicit override baked into its runtime value; trust it.
    const mapped = mapHostImageProtocol(marker);
    return {
      protocol: mapped,
      detail: mapped ? `protocol: ${mapped} (host override)` : "protocol: none (host override)",
    };
  }
  // Shared detection (lazy-cached by the host module itself; read-only here).
  const caps = getCapabilities();
  if (caps.images) return { protocol: caps.images, detail: `protocol: ${caps.images}` };
  const mux = detectMultiplexer(env);
  if (mux !== "none") {
    return { protocol: null, detail: `protocol: none (${mux} conservatively disables image protocols)` };
  }
  return { protocol: null, detail: "protocol: none (terminal fallback)" };
}

function hostDiagnostics(env: NodeJS.ProcessEnv): string[] {
  const onSsh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const cell = getCellDimensions();
  const details = [
    `host: ${ompTerminal() ? "oh-my-pi" : "pi"}`,
    `terminal: ${detectTerminalName(env)}`,
    `multiplexer: ${detectMultiplexer(env)}`,
    `ssh: ${onSsh ? "yes" : "no"}`,
    `cell: ${cell.widthPx}x${cell.heightPx}px`,
  ];
  const forced = env.PI_FORCE_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (forced) details.push(`env: PI_FORCE_IMAGE_PROTOCOL=${forced}`);
  return details;
}

/**
 * Capability report for the current terminal. Safe to call repeatedly;
 * never mutates host capability state.
 */
export function capabilities(
  env: NodeJS.ProcessEnv = process.env,
  hostProtocolMarker?: string | null,
): HostCapabilities {
  const cell = getCellDimensions();
  const cellWidth = Math.max(1, cell.widthPx);
  const cellHeight = Math.max(1, cell.heightPx);
  const resolved = resolveImageProtocol(env, hostProtocolMarker);
  return {
    protocol: resolved.protocol,
    cellWidth,
    cellHeight,
    details: [...hostDiagnostics(env), resolved.detail],
  };
}

/** Cell geometry an image with these pixel dimensions occupies (host formula). */
function fitCells(
  dims: { widthPx: number; heightPx: number },
  maxWidthCells: number,
  maxHeightCells: number,
  cell: { widthPx: number; heightPx: number },
): { columns: number; rows: number } {
  const scale = Math.min(
    (maxWidthCells * cell.widthPx) / dims.widthPx,
    (maxHeightCells * cell.heightPx) / dims.heightPx,
  );
  return {
    columns: Math.max(1, Math.min(maxWidthCells, Math.ceil((dims.widthPx * scale) / cell.widthPx))),
    rows: Math.max(1, Math.min(maxHeightCells, Math.ceil((dims.heightPx * scale) / cell.heightPx))),
  };
}

/** Labels land in fallback text lines; strip anything that could break layout. */
function sanitizeLabel(label: string): string {
  return label.replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function writeRaw(tui: TUI | undefined, data: string): void {
  const terminal = (tui as { terminal?: { write?: (s: string) => void } } | undefined)?.terminal;
  if (typeof terminal?.write === "function") {
    terminal.write(data);
  } else {
    process.stdout.write(data);
  }
}

/**
 * Create a scoped inline image from a PNG buffer.
 *
 * `widthCells`/`heightCells` are the cell box the caller rasterized the PNG
 * for (`(width-2) * cellWidth` x `rows * cellHeight` pixels). The emitted
 * escape sequences carry exactly those cell counts; `render(width)` returns
 * one line per row (sequence plus padding lines), unmodified.
 */
export function createTerminalImage(
  png: Buffer,
  widthCells: number,
  heightCells: number,
  label: string,
  tui: TUI,
): TerminalImage {
  const maxWidthCells = Math.max(1, Math.floor(widthCells));
  const maxHeightCells = Math.max(1, Math.floor(heightCells));
  const base64 = png.toString("base64");
  const cell = getCellDimensions();
  const dims = getImageDimensions(base64, "image/png") ?? {
    widthPx: maxWidthCells * cell.widthPx,
    heightPx: maxHeightCells * cell.heightPx,
  };
  const fit = fitCells(dims, maxWidthCells, maxHeightCells, cell);
  const protocol = resolveImageProtocol(process.env).protocol;

  // Pi accepts imageId directly. OMP 18.2 ignores that option without a
  // renderer-owned ImageBudget, so tag its anonymous transmissions below.
  const imageId = protocol === "kitty"
    ? (typeof allocateImageId === "function" ? allocateImageId() : randomInt(1, 0x100000000))
    : undefined;

  const native = new Image(
    base64,
    "image/png",
    { fallbackColor: (s) => s },
    {
      maxWidthCells,
      maxHeightCells,
      filename: sanitizeLabel(label),
      ...(imageId !== undefined ? { imageId } : {}),
    },
    dims,
  );

  let disposed = false;
  let nativeLines: readonly string[] | undefined;
  let ownedLines: string[] | undefined;

  return {
    get imageId() {
      return imageId;
    },
    get columns() {
      return fit.columns;
    },
    get rows() {
      return fit.rows;
    },
    render(width: number): string[] {
      if (disposed) return [];
      const lines = native.render(width);
      if (imageId === undefined) return lines;
      if (lines === nativeLines) return ownedLines!;
      nativeLines = lines;
      ownedLines = lines.map(line => line.replace(/\x1b_G([^;]*);/g, (sequence, header: string) => {
        const fields = header.split(",");
        if (!fields.some(field => field === "a=T" || field === "a=t" || field === "a=p")) return sequence;
        // Negative enough to sit below explicit cell backgrounds: an opaque
        // modal can cover the image while surrounding default cells retain it.
        return `\x1b_G${fields.filter(field => !field.startsWith("i=") && !field.startsWith("z=")).join(",")},i=${imageId},z=-1073741825;`;
      }));
      return ownedLines;
    },
    invalidate() {
      native.invalidate();
      nativeLines = undefined; ownedLines = undefined;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      native.invalidate();
      nativeLines = undefined; ownedLines = undefined;
      if (imageId !== undefined) {
        try {
          const ompDelete = (piTui as typeof piTui & { encodeKittyDeleteImage?: (id: number) => string }).encodeKittyDeleteImage;
          const remove = typeof deleteKittyImage === "function" ? deleteKittyImage : ompDelete;
          let sequence: string;
          if (remove) sequence = remove(imageId); // OMP's encoder includes its tmux passthrough.
          else {
            sequence = `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
            if (process.env.TMUX) sequence = `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
          }
          writeRaw(tui, sequence);
        } catch {
          // Terminal may already be gone; nothing else to release.
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Scoped wheel capture
// ---------------------------------------------------------------------------

const WHEEL_STEP_LINES = 3;
const MAX_PENDING_BYTES = 64;

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const SGR_MOUSE_PARTIAL = /^\x1b\[<[\d;]*$/;
const X10_MOUSE_PREFIX = "\x1b[M";
const URXVT_MOUSE = /^\x1b\[(\d+);(\d+);(\d+)[Mm]/;
const DECRPM_REPLY = /^\x1b\[\?(\d+);(\d+)\$y/;
const DECRPM_PARTIAL = /^\x1b\[\?[\d;]+\$?$/;

const MOUSE_ENABLE = "\x1b[?1000h\x1b[?1006h";
const MOUSE_QUERY = "\x1b[?1000$p\x1b[?1002$p\x1b[?1003$p\x1b[?1006$p";
const PROBED_MODES: readonly number[] = [1000, 1002, 1003, 1006];

type ParsedInput =
  | { kind: "wheel"; delta: number }
  | { kind: "click"; x: number; y: number }
  | { kind: "noise" }
  | { kind: "decrpm"; mode: number; value: number };

interface StreamState {
  probing: boolean;
  /** Mode numbers still awaiting a DECRPM reply. */
  pendingModes: Set<number>;
  /** Incomplete mouse/DECRPM packet held for the next chunk. */
  held: string;
}

function wheelDelta(button: number): number | null {
  if ((button & 64) === 0) return null;
  const direction = button & 3;
  if (direction === 0) return -WHEEL_STEP_LINES;
  if (direction === 1) return WHEEL_STEP_LINES;
  return null; // horizontal scroll: swallow silently
}

function probeTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(env.PI_VIEW_MOUSE_PROBE_MS ?? "", 10);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(2000, raw));
  return 200;
}

/**
 * Incrementally parse raw stdin. Complete mouse packets (SGR / X10 / urxvt)
 * become wheel, click or noise events; DECRPM replies are captured while probing.
 * The TUI's stdin buffer normally delivers sequence-aligned chunks, so the
 * hold-back path only guards against a flushed partial packet. A lone ESC is
 * always passed through so Escape key handling stays intact.
 */
function parseMouseStream(
  buffer: string,
  state: StreamState,
): { events: ParsedInput[]; rest: string; held: string } {
  const events: ParsedInput[] = [];
  let rest = "";
  let pos = 0;
  while (pos < buffer.length) {
    const slice = buffer.slice(pos);
    if (state.probing) {
      const reply = DECRPM_REPLY.exec(slice);
      if (reply) {
        events.push({ kind: "decrpm", mode: Number(reply[1]), value: Number(reply[2]) });
        pos += reply[0].length;
        continue;
      }
      if (slice.length <= MAX_PENDING_BYTES && DECRPM_PARTIAL.test(slice)) {
        return { events, rest, held: slice };
      }
    }
    if (!slice.startsWith("\x1b")) {
      const nextEsc = slice.indexOf("\x1b");
      const plain = nextEsc === -1 ? slice : slice.slice(0, nextEsc);
      rest += plain;
      pos += plain.length;
      continue;
    }
    const sgr = SGR_MOUSE.exec(slice);
    if (sgr) {
      const button = Number(sgr[1]);
      const delta = wheelDelta(button);
      events.push(delta !== null ? { kind: "wheel", delta }
        : sgr[4] === "M" && button === 0 ? { kind: "click", x: Number(sgr[2]) - 1, y: Number(sgr[3]) - 1 }
        : { kind: "noise" });
      pos += sgr[0].length;
      continue;
    }
    if (slice.startsWith(X10_MOUSE_PREFIX) && slice.length >= 6) {
      const button = slice.charCodeAt(3) - 32;
      const delta = wheelDelta(button);
      events.push(delta !== null ? { kind: "wheel", delta }
        // X10 carries no event subtype; a release is encoded as button 3.
        : button === 0 ? { kind: "click", x: slice.charCodeAt(4) - 33, y: slice.charCodeAt(5) - 33 }
        : { kind: "noise" });
      pos += 6;
      continue;
    }
    const urxvt = URXVT_MOUSE.exec(slice);
    if (urxvt) {
      const button = Number(urxvt[1]) - 32;
      const delta = wheelDelta(button);
      events.push(delta !== null ? { kind: "wheel", delta }
        : button === 0 ? { kind: "click", x: Number(urxvt[2]) - 1, y: Number(urxvt[3]) - 1 }
        : { kind: "noise" });
      pos += urxvt[0].length;
      continue;
    }
    // Incomplete mouse/DECRPM packet head: hold it for the next chunk.
    const holdable =
      slice.length <= MAX_PENDING_BYTES &&
      (slice === X10_MOUSE_PREFIX ||
        (slice.startsWith(X10_MOUSE_PREFIX) && slice.length < 6) ||
        (slice.startsWith("\x1b[<") && SGR_MOUSE_PARTIAL.test(slice)) ||
        (state.probing && DECRPM_PARTIAL.test(slice)));
    if (holdable) {
      return { events, rest, held: slice };
    }
    // Anything else (lone ESC, arrow keys, unrelated CSI/OSC) belongs to the
    // keyboard: pass through up to the next escape boundary.
    const nextEsc = slice.indexOf("\x1b", 1);
    const chunk = nextEsc === -1 ? slice : slice.slice(0, nextEsc);
    rest += chunk;
    pos += chunk.length;
  }
  return { events, rest, held: "" };
}

/**
 * Capture mouse wheel and primary-button click input for the active overlay via
 * the TUI's raw input listener (identical behavior on Pi and OMP; the
 * normalized `handleMouse` dispatch is not portable between hosts).
 *
 * - OMP owns mouse modes through its fullscreen overlays. Pi queries mode state
 *   before changing it, and only modes changed by this overlay are restored.
 * - Without probe support, leaves terminal modes untouched (keyboard fallback).
 * - Wheel packets invoke `onWheel(delta)` (logical lines, negative = up);
 *   a primary-button press invokes `onClick(column, row)` (0-based) when
 *   provided. Press/release/motion packets are consumed as noise; every other
 *   byte passes through, so normal keyboard data is never consumed.
 *
 * Returns an idempotent detach function restoring terminal state.
 */
export function attachMouse(tui: TUI, onWheel: (delta: number) => void, onClick?: (column: number, row: number) => void): () => void {
  if (typeof tui.addInputListener !== "function") return () => {};
  // OMP consumes DECRPM replies before raw listeners; its TUI owns the modes.
  const hostOwnsMouse = ompTerminal() !== undefined;
  const timeout = hostOwnsMouse ? 0 : probeTimeoutMs(process.env);
  const state: StreamState = { probing: timeout > 0, pendingModes: new Set(PROBED_MODES), held: "" };
  const originalModes = new Map<number, number>();
  const changedModes: number[] = [];
  let detached = false;
  let timer: NodeJS.Timeout | undefined;

  const listener: TuiInputListener = data => {
    if (detached) return;
    const { events, rest, held } = parseMouseStream(state.held + data, state);
    state.held = held;
    for (const event of events) {
      if (event.kind === "decrpm" && state.pendingModes.delete(event.mode)) {
        originalModes.set(event.mode, event.value);
        if (!state.pendingModes.size) {
          state.probing = false;
          // Query BEFORE changing modes. Never guess the prior state when a
          // terminal cannot answer; keyboard navigation remains available.
          if ([...originalModes.values()].every(value => value >= 1 && value <= 4)) {
            const tracking = [1000, 1002, 1003].some(mode => [1, 3].includes(originalModes.get(mode)!));
            if (!tracking && originalModes.get(1000) === 2) changedModes.push(1000);
            if (originalModes.get(1006) === 2) changedModes.push(1006);
            for (const mode of changedModes) writeRaw(tui, `\x1b[?${mode}h`);
          }
        }
      } else if (event.kind === "wheel") {
        onWheel(event.delta);
      } else if (event.kind === "click" && onClick) {
        onClick(event.x, event.y);
      }
    }
    if (!state.held && rest === data) return;
    return rest ? { data: rest } : { consume: true };
  };
  const removeListener = tui.addInputListener(listener);
  if (timeout > 0) {
    writeRaw(tui, MOUSE_QUERY);
    timer = setTimeout(() => { state.probing = false; state.held = ""; }, timeout);
    timer.unref();
  } else if (!hostOwnsMouse) {
    // Explicit opt-out for terminals without DECRQM; assumes modes were off.
    changedModes.push(1000, 1006);
    writeRaw(tui, MOUSE_ENABLE);
  }
  return () => {
    if (detached) return;
    detached = true; clearTimeout(timer); state.held = "";
    removeListener();
    try {
      for (const mode of changedModes.reverse()) writeRaw(tui, `\x1b[?${mode}l`);
    } catch { /* The terminal may already be closed. */ }
  };
}
