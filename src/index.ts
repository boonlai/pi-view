import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, type AutocompleteItem } from "@earendil-works/pi-tui";
import { completePath, resolvePath } from "./paths.ts";
import { safeText } from "./documents.ts";
import { PreviewViewer } from "./viewer.ts";
import { QuickOpen } from "./quick-open.ts";
import { recentFiles } from "./recents.ts";

export default function piView(pi: ExtensionAPI): void {
  let cwd = process.cwd();
  let closePreview: (() => void) | undefined;
  let closeQuick: (() => void) | undefined;
  let detachShortcut: (() => void) | undefined;
  let quickPending = false;
  let providerInstalled = false;

  const completions = (args: string): AutocompleteItem[] | null => args.startsWith("--")
    ? ["--help", "--diagnostics"].filter(value => value.startsWith(args)).map(value => ({ value, label: value }))
    : completePath(args, cwd);

  async function showPreview(ctx: ExtensionContext, path: string, initial?: "help" | "diagnostics"): Promise<void> {
    closePreview?.();
    if (!initial) {
      try { if ((await stat(path)).isFile()) pi.appendEntry("pi-view-open", { path }); } catch {}
    }
    let viewer: PreviewViewer | undefined;
    let localClose: (() => void) | undefined;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let ended = false;
        localClose = () => {
          if (ended) return;
          ended = true; viewer?.dispose();
          if (closePreview === localClose) closePreview = undefined;
          done();
        };
        viewer = new PreviewViewer(tui, theme, localClose, path, initial);
        closePreview = localClose;
        return viewer;
      }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", row: 0, col: 0 } });
    } finally {
      viewer?.dispose();
      if (closePreview === localClose) closePreview = undefined;
    }
  }

  async function showQuick(ctx: ExtensionContext): Promise<void> {
    if (quickPending || !ctx.hasUI) return;
    quickPending = true;
    let quick: QuickOpen | undefined;
    let picked: string | undefined;
    try {
      picked = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
        let ended = false;
        const finish = (path?: string) => {
          if (ended) return;
          ended = true; quick?.dispose(); closeQuick = undefined; done(path);
        };
        closeQuick = () => finish();
        quick = new QuickOpen(tui, theme, ctx.cwd, recentFiles(ctx.sessionManager.getBranch(), ctx.cwd), finish);
        return quick;
      }, { overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", anchor: "top-center", row: 2 } });
    } finally { quick?.dispose(); closeQuick = undefined; quickPending = false; }
    if (picked) await showPreview(ctx, picked);
  }

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
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
  pi.on("session_shutdown", () => { detachShortcut?.(); closeQuick?.(); closePreview?.(); });
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
