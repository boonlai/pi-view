import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, type AutocompleteItem, type Component, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
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
  let cwd = process.cwd();
  let quickPending = false;
  let providerInstalled = false;
  // Bumped on every session boundary; picks and requests spanning a boundary
  // across the awaited ctx.ui.custom are dropped instead of leaking late UI.
  let lifetime = 0;
  let detachShortcut: (() => void) | undefined;
  let closePreview: (() => void) | undefined;
  let closeQuick: (() => void) | undefined;

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
    closePreview?.();
    let viewer: PreviewViewer | undefined;
    let handle: OverlayHandle | undefined;
    let localClose: (() => void) | undefined;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let ended = false;
        localClose = () => {
          if (ended) return;
          ended = true; viewer?.dispose();
          if (closePreview === localClose) closePreview = undefined;
          closeOwned(tui, handle, done);
        };
        viewer = new PreviewViewer(tui, theme, localClose, path, initial, recordOpen);
        closePreview = localClose;
        return viewer;
      }, {
        overlay: true,
        overlayOptions: { ...fullscreen, width: "100%", maxHeight: "100%", anchor: "top-left", row: 0, col: 0 },
        onHandle: received => { handle = received; },
      });
    } finally {
      viewer?.dispose();
      if (closePreview === localClose) closePreview = undefined;
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
        overlayOptions: { ...fullscreen, width: "80%", maxHeight: "90%", anchor: "top-center", row: 2 },
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
    closePreview?.();
    closeQuick?.();
    detachShortcut?.();
    if (!ctx.hasUI) return;
    // Registered shortcuts are editor-scoped in Pi. The raw hook also works
    // over previews and other dialogs, without replacing their input handlers.
    detachShortcut = ctx.ui.onTerminalInput(data => {
      if (!matchesKey(data, "super+p")) return;
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
  pi.on("session_shutdown", () => { lifetime++; detachShortcut?.(); closeQuick?.(); closePreview?.(); stopImageWorker(); });
  pi.registerShortcut("super+p", {
    description: "Quick Open: recent session files and path completion",
    handler: ctx => showQuick(ctx).catch(error => ctx.ui.notify(safeText((error as Error).message), "error")),
  });

  for (const name of ["view", "v"]) {
    pi.registerCommand(name, {
      description: "Preview a file (Tab completes paths); no path opens Quick Open",
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
