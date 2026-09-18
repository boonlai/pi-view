import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, isKeyRelease, matchesKey, type AutocompleteItem, type Component, type KeyId, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { completePath, resolvePath } from "./paths.ts";
import { safeText } from "./documents.ts";
import { PreviewViewer } from "./viewer.ts";
import { QuickOpen } from "./quick-open.ts";
import { recentFiles } from "./recents.ts";
import { stopImageWorker } from "./image-client.ts";
import { isOmpHost } from "./host.ts";

// OMP owns the alternate buffer and mouse modes; Pi ignores this extra option.
const fullscreen = { fullscreen: true };

// Pi 0.85.1's InteractiveMode closes custom overlays by calling ui.hideOverlay(),
// which pops the top overlayStack entry — not necessarily ours. If a foreign
// overlay (or QuickOpen) sits above us, that close would remove the wrong
// overlay and leave ours mounted but disposed. On Pi our entry is removed
// ownership-safely through the public OverlayHandle (options.onHandle ->
// handle.hide()); a synchronous non-capturing claim overlay then makes the LIFO
// pop inside done() consume a throwaway entry instead of a foreign overlay, and
// the claim is removed defensively afterwards. Claim + done run in one tick: no
// render, input, or foreign promise can interleave, and a non-capturing entry
// never takes focus or consumes input. OMP v18.2 done() already hides the
// overlay through its own handle, so the workaround is bypassed there.
const overlayClaim: Component = { render: () => [], invalidate: () => {} };

function closeOwned(tui: TUI, handle: OverlayHandle | undefined, done: () => void): void {
  if (isOmpHost()) { done(); return; }
  handle?.hide();
  const claim = tui.showOverlay(overlayClaim, { nonCapturing: true });
  try { done(); } finally { claim.hide(); }
}

export default function piView(pi: ExtensionAPI): void {
  const shortcut = (process.env.PI_VIEW_SHORTCUT?.trim().toLowerCase() || (process.platform === "win32" ? "ctrl+p" : "super+p")) as KeyId;
  const modifiers = shortcut.split("+");
  const key = modifiers.pop()!;
  if (modifiers.some(modifier => !["ctrl", "alt", "shift", "super"].includes(modifier))
    || !(/^[a-z0-9]$/.test(key) || Object.values(Key).some(value => typeof value === "string" && value.toLowerCase() === key))) {
    throw new Error(`Invalid PI_VIEW_SHORTCUT "${safeText(shortcut)}"; use a key such as ctrl+alt+p.`);
  }
  let cwd = process.cwd();
  let quickPending = false;
  let providerInstalled = false;
  // Bumped on every session boundary; picks and requests spanning a boundary
  // across the awaited ctx.ui.custom are dropped instead of leaking late UI.
  let lifetime = 0;
  let detachShortcut: (() => void) | undefined;
  let closePreview: ((force?: boolean) => boolean) | undefined;
  let closeQuick: (() => void) | undefined;
  let activeViewer: PreviewViewer | undefined;

  const completions = (args: string): AutocompleteItem[] | null => args.startsWith("--")
    ? ["--help", "--diagnostics"].filter(value => value.startsWith(args)).map(value => ({ value, label: value }))
    : completePath(args, cwd);

  // The viewer only reports successful regular-file opens (including
  // directory-browser picks); recording stays best-effort and must never
  // break the preview. An await-based preflight here would reopen the
  // overlapping-start window.
  const recordOpen = (path: string): void => {
    try { pi.appendEntry("pi-view-open", { path }); } catch {}
  };

  async function showPreview(ctx: ExtensionContext, path: string, initial?: "help" | "diagnostics"): Promise<void> {
    if (closePreview && !closePreview()) {
      ctx.ui.notify("Neovim session active — finish with :q or :wq (or :q! to discard), then try again", "warning");
      return;
    }
    let viewer: PreviewViewer | undefined;
    let handle: OverlayHandle | undefined;
    let localClose: ((force?: boolean) => boolean) | undefined;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let ended = false;
        localClose = (force = false): boolean => {
          if (ended) return true;
          if (!force && viewer && !viewer.requestClose()) return false;
          ended = true; viewer?.dispose();
          if (closePreview === localClose) closePreview = undefined;
          closeOwned(tui, handle, done);
          return true;
        };
        viewer = new PreviewViewer(tui, theme, localClose, path, initial, recordOpen);
        closePreview = localClose;
        activeViewer = viewer;
        return viewer;
      }, {
        overlay: true,
        overlayOptions: { ...fullscreen, width: "100%", maxHeight: "100%", anchor: "top-left", row: 0, col: 0 },
        onHandle: received => { handle = received; },
      });
    } finally {
      viewer?.dispose();
      if (closePreview === localClose) closePreview = undefined;
      if (activeViewer === viewer) activeViewer = undefined;
    }
  }

  async function showQuick(ctx: ExtensionContext): Promise<void> {
    if (quickPending || !ctx.hasUI) return;
    quickPending = true;
    const requested = lifetime;
    let quick: QuickOpen | undefined;
    let handle: OverlayHandle | undefined;
    let picked: string | undefined;
    try {
      picked = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
        let ended = false;
        const finish = (path?: string) => {
          if (ended) return;
          ended = true; quick?.dispose(); closeQuick = undefined;
          closeOwned(tui, handle, () => done(path));
        };
        closeQuick = () => finish();
        quick = new QuickOpen(tui, theme, ctx.cwd, recentFiles(ctx.sessionManager.getBranch(), ctx.cwd), finish);
        return quick;
      }, {
        overlay: true,
        // Borrow the preview's alternate screen only when one is already open;
        // a standalone picker must leave the normal agent viewport behind it.
        // Nested pickers start below the preview's image-control row.
        overlayOptions: { ...(closePreview ? fullscreen : {}), width: "80%", maxHeight: "90%", anchor: "top-center", row: closePreview ? 3 : 2 },
        onHandle: received => { handle = received; },
      });
    } finally { quick?.dispose(); closeQuick = undefined; quickPending = false; }
    if (picked && lifetime !== requested) picked = undefined;
    if (picked) await showPreview(ctx, picked);
  }

  pi.on("session_start", (_event, ctx) => {
    lifetime++;
    cwd = ctx.cwd;
    // A new session must not inherit the previous session's overlays.
    closePreview?.(true);
    closeQuick?.();
    detachShortcut?.();
    if (!ctx.hasUI) return;
    // One global hook covers the editor and overlays. Editor-only shortcut
    // registration is redundant and rejects reserved chords such as Ctrl+P.
    detachShortcut = ctx.ui.onTerminalInput(data => {
      if (!matchesKey(data, shortcut)) return;
      // While an embedded editor session owns the preview it owns this
      // shortcut too (nvim insert-mode Ctrl+P): pass the key through.
      if (activeViewer?.editing) return;
      if (!isKeyRelease(data)) void showQuick(ctx).catch(error => ctx.ui.notify(safeText((error as Error).message), "error"));
      return { consume: true };
    });
    // Pi's forced-Tab branch otherwise bypasses command argument completers.
    // Use its public provider hook when available; Quick Open owns its Tab path
    // independently, including on hosts without this newer hook.
    if (!providerInstalled && typeof ctx.ui.addAutocompleteProvider === "function") {
      providerInstalled = true;
      ctx.ui.addAutocompleteProvider(current => ({
        triggerCharacters: current.triggerCharacters,
        async getSuggestions(lines, row, col, options) {
          const match = /^\/(?:view|v) (.*)$/.exec((lines[row] ?? "").slice(0, col));
          if (match) {
            const items = completions(match[1]);
            return items?.length ? { items, prefix: match[1] } : null;
          }
          return current.getSuggestions(lines, row, col, options);
        },
        applyCompletion: current.applyCompletion.bind(current),
        shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
      }));
    }
  });
  pi.on("session_shutdown", () => { lifetime++; detachShortcut?.(); closeQuick?.(); closePreview?.(true); stopImageWorker(); });
  for (const name of ["view", "v"]) {
    pi.registerCommand(name, {
      description: "Preview a file or leave blank to trigger Quick Open",
      getArgumentCompletions: completions,
      handler: async (args, ctx) => {
        cwd = ctx.cwd;
        if (!ctx.hasUI) { ctx.ui.notify("/view needs an interactive terminal session", "warning"); return; }
        try {
          const option = args.trim();
          if (!option) { await showQuick(ctx); return; }
          const initial = option === "--diagnostics" ? "diagnostics" : option === "--help" ? "help" : undefined;
          await showPreview(ctx, initial ? ctx.cwd : resolvePath(args, ctx.cwd), initial);
        } catch (error) { ctx.ui.notify(safeText((error as Error).message), "error"); }
      },
    });
  }
}
