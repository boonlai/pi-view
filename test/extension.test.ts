import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { initTheme, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
import { CombinedAutocompleteProvider, TuiMainScreen, type AutocompleteProvider, type Component, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import piView from "../src/index.ts";
import { QuickOpen } from "../src/quick-open.ts";
import { PreviewViewer } from "../src/viewer.ts";
import { resolvePath } from "../src/paths.ts";

initTheme("dark", false);
type View = Component & { dispose?(): void; focused?: boolean };

// The real Pi 0.85.1 overlay lifecycle: factories mount asynchronously via
// Promise.resolve(...).then, closes pop the top overlayStack entry through
// ui.hideOverlay(), and onHandle exposes the ownership-safe OverlayHandle.
// Driving it against a real TUI keeps the LIFO close semantics honest.
type CustomFactory = (tui: TUI, theme: Theme, keys: never, done: (value?: string) => void) => View;
type CustomOptions = { overlay?: boolean; overlayOptions?: unknown; onHandle?: (handle: OverlayHandle) => void };
const showExtensionCustom = (InteractiveMode.prototype as unknown as { showExtensionCustom: unknown }).showExtensionCustom as
  (this: { editor: { getText(): string }; ui: TUI }, factory: CustomFactory, options?: CustomOptions) => Promise<string | undefined>;

function stubTerminal() {
  const term = {
    onInput: undefined as ((data: string) => void) | undefined,
    start(onInput: (data: string) => void) { term.onInput = onInput; },
    stop() {}, drainInput: async () => {}, write() {},
    columns: 80, rows: 24, kittyProtocolActive: false,
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
    clearScreen() {}, setTitle() {}, setProgress() {},
  };
  return term;
}

interface ForeignOverlay extends Component {
  focused: boolean;
  received: string[];
}

function foreignOverlay(): ForeignOverlay {
  return { focused: false, received: [], render: () => [], invalidate() {}, handleInput(data: string) { this.received.push(data); } };
}

async function host(t: { after(fn: () => void | Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-view-extension-"));
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionContext): Promise<void>; getArgumentCompletions(args: string): unknown }>();
  const term = stubTerminal();
  const tui = new TuiMainScreen(term);
  tui.start();
  // Input flows through the public terminal.start callback wired by tui.start().
  const send = (data: string) => term.onInput?.(data);
  const shortcuts = new Map<string, unknown>();
  const entries: unknown[] = [];
  const listeners = new Set<(data: string) => { consume?: boolean; data?: string } | undefined>();
  const providerFactory: ((current: AutocompleteProvider) => AutocompleteProvider)[] = [];
  const fire = (name: string) => events.get(name)!({}, context);
  const context = {
    cwd, hasUI: true, sessionManager: { getBranch: () => entries },
    ui: {
      notify(message: string) { throw new Error(message); },
      onTerminalInput(listener: (data: string) => undefined) {
        listeners.add(listener);
        return tui.addInputListener(listener);
      },
      addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) { providerFactory.push(factory); },
      custom: (factory: CustomFactory, options?: CustomOptions) =>
        showExtensionCustom.call({ editor: { getText: () => "" }, ui: tui }, factory, options),
    },
  } as unknown as ExtensionContext;
  const pi = {
    on(name: string, callback: (event: unknown, ctx: ExtensionContext) => unknown) { events.set(name, callback); },
    registerCommand(name: string, command: { handler(args: string, ctx: ExtensionContext): Promise<void>; getArgumentCompletions(args: string): unknown }) { commands.set(name, command); },
    registerShortcut(name: string, shortcut: unknown) { shortcuts.set(name, shortcut); },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
  } as unknown as ExtensionAPI;
  piView(pi);
  fire("session_start");
  t.after(async () => {
    fire("session_shutdown");
    tui.stop();
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd, context, commands, shortcuts, entries, listeners, tui, send, fire,
    focused: () => tui.getFocusedComponent(),
    hasOverlay: () => tui.hasOverlay(),
    provider: () => providerFactory[0],
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await delay(10);
  assert.ok(predicate());
}

test("Both empty commands open Quick Open, and Cmd+P layers it over a preview", async t => {
  const app = await host(t);
  const path = join(app.cwd, "code.ts"); await writeFile(path, "const preview = true;");
  // Both aliases dispatch their empty command to Quick Open: real handlers,
  // native async mount, real picker close — not registration-map checks.
  for (const name of ["view", "v"] as const) {
    const open = app.commands.get(name)!.handler("", app.context);
    await until(() => app.focused() instanceof QuickOpen);
    app.send("\x1b");
    await until(() => !app.hasOverlay());
    await open;
    assert.equal(app.focused(), null);
  }
  const pending = app.commands.get("view")!.handler(path, app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  const preview = app.focused() as PreviewViewer;
  let consumed = false;
  for (const listener of app.listeners) if (listener("\x1b[112;9u")?.consume) { consumed = true; break; }
  assert.ok(consumed);
  await until(() => app.focused() instanceof QuickOpen);
  assert.equal(preview.focused, false);
  app.send("\x1b");
  await until(() => app.focused() === preview);
  assert.equal(preview.focused, true);
  await until(() => app.entries.length === 1);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path } }]);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  assert.equal(app.focused(), null);
  await pending;
});

test("Overlapping /view requests mount exactly one preview", async t => {
  const app = await host(t);
  const a = join(app.cwd, "a.ts"); await writeFile(a, "a");
  const b = join(app.cwd, "b.ts"); await writeFile(b, "b");
  const view = app.commands.get("view")!.handler;
  // Rapid pair: the second request cancels the first before its mount runs.
  const rapidA = view(a, app.context);
  const rapidB = view(b, app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  await until(() => app.entries.length === 1);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path: b } }]);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  await Promise.all([rapidA, rapidB]);
  // Interleaved pair: the first preview is already mounted, the replacement
  // removes it through its own handle instead of stacking a second overlay.
  const first = view(a, app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  const second = view(b, app.context);
  await until(() => app.entries.length === 2);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  await Promise.all([first, second]);
  assert.equal(app.focused(), null);
});

test("session_shutdown closes an open preview and cancels a pending mount without touching foreign overlays", async t => {
  const app = await host(t);
  const path = join(app.cwd, "code.ts"); await writeFile(path, "const preview = true;");
  const pending = app.commands.get("view")!.handler(path, app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  const foreign = foreignOverlay();
  app.tui.showOverlay(foreign);
  await until(() => app.focused() === foreign);
  app.fire("session_shutdown");
  await pending;
  await until(() => !(app.focused() instanceof PreviewViewer));
  assert.equal(app.focused(), foreign);
  app.send("x");
  await until(() => foreign.received.includes("x"));
  // The successful open was recorded before shutdown closed the preview.
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path } }]);
  // A request whose mount is still pending is cancelled by shutdown; the
  // never-mounted viewer records nothing and the foreign overlay stays put.
  const late = app.commands.get("view")!.handler(path, app.context);
  app.fire("session_shutdown");
  await late;
  await delay(30);
  assert.ok(!(app.focused() instanceof PreviewViewer));
  assert.equal(app.focused(), foreign);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path } }]);
  // Noncapturing foreign overlays are equally spared by the claim close.
  const passive = foreignOverlay();
  app.tui.showOverlay(passive, { nonCapturing: true });
  const pendingPassive = app.commands.get("view")!.handler(path, app.context);
  app.fire("session_shutdown");
  await pendingPassive;
  await delay(30);
  assert.ok(!(app.focused() instanceof PreviewViewer));
  assert.equal(app.focused(), foreign);
  assert.ok(app.hasOverlay());
 });

test("Replacing a background preview beneath a foreign overlay leaves the foreign overlay alive", async t => {
  const app = await host(t);
  const a = join(app.cwd, "a.ts"); await writeFile(a, "a");
  const view = app.commands.get("view")!.handler;
  const background = view(a, app.context);
  await until(() => app.focused() instanceof PreviewViewer && app.entries.length === 1);
  const foreign = foreignOverlay();
  app.tui.showOverlay(foreign);
  await until(() => app.focused() === foreign);
  // Cmd+P selection over the foreign overlay: QuickOpen picks the recent file
  // and showPreview replaces the background preview beneath it.
  app.send("\x1b[112;9u");
  await until(() => app.focused() instanceof QuickOpen);
  app.send("\r");
  await until(() => app.focused() instanceof PreviewViewer);
  app.send("\x1b");
  await until(() => app.focused() === foreign);
  app.send("x");
  await until(() => foreign.received.includes("x"));
  await background;
});

test("Recents record regular-file opens through the viewer callback, not directory listings or failures", async t => {
  const app = await host(t);
  await mkdir(join(app.cwd, "sub"));
  const note = join(app.cwd, "sub", "note.md"); await writeFile(note, "# note");
  const missing = join(app.cwd, "nope.ts");
  const view = app.commands.get("view")!.handler;
  const dirPreview = view(join(app.cwd, "sub"), app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  await delay(30);
  assert.deepEqual(app.entries, []);
  // Directory browser choice: Enter opens the first listed entry.
  app.send("\r");
  await until(() => app.entries.length === 1);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path: note } }]);
  // Reload of the same file must not record a second open.
  app.send("r");
  await delay(50);
  assert.equal(app.entries.length, 1);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  await dirPreview;
  // Help panels and failed loads record nothing.
  const help = view("--help", app.context);
  await until(() => app.focused() instanceof PreviewViewer);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path: note } }]);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  await help;
  const failed = view(missing, app.context);
  await delay(50);
  assert.equal(app.entries.length, 1);
  app.send("\x1b");
  await until(() => !app.hasOverlay());
  await failed;
});

test("Forced Tab uses the extension path grammar for both command aliases", async t => {
  const app = await host(t);
  await mkdir(join(app.cwd, "my docs"));
  const name = 'a "quoted" file.ts';
  await writeFile(join(app.cwd, "my docs", name), "fixture");
  const original = new CombinedAutocompleteProvider([], app.cwd);
  const provider = app.provider()!(original);
  for (const command of ["view", "v"]) {
    const line = `/${command} my`;
    const result = await provider.getSuggestions([line], 0, line.length, { force: true, signal: new AbortController().signal });
    assert.ok(result);
    const first = provider.applyCompletion([line], 0, line.length, result.items[0], result.prefix);
    const children = await provider.getSuggestions(first.lines, 0, first.cursorCol, { force: true, signal: new AbortController().signal });
    assert.ok(children);
    assert.equal(resolvePath(children.items[0].value, app.cwd), join(app.cwd, "my docs", name));
  }
});
