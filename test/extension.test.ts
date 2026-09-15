import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { initTheme, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CombinedAutocompleteProvider, type AutocompleteProvider, type Component, type TUI } from "@earendil-works/pi-tui";
import piView from "../src/index.ts";
import { QuickOpen } from "../src/quick-open.ts";
import { PreviewViewer } from "../src/viewer.ts";
import { resolvePath } from "../src/paths.ts";

initTheme("dark", false);
type View = Component & { dispose?(): void; focused?: boolean };

async function host(t: { after(fn: () => void | Promise<void>): void }) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-view-extension-"));
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const commands = new Map<string, { handler(args: string, ctx: ExtensionContext): Promise<void>; getArgumentCompletions(args: string): unknown }>();
  const shortcuts = new Map<string, unknown>();
  const entries: unknown[] = [];
  const listeners = new Set<(data: string) => { consume?: boolean; data?: string } | undefined>();
  let active: View | undefined;
  let providerFactory: ((current: AutocompleteProvider) => AutocompleteProvider) | undefined;
  const tui = {
    terminal: { columns: 80, rows: 24, write() {} }, requestRender() {},
    addInputListener(listener: (data: string) => undefined) { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as TUI;
  const context = {
    cwd, hasUI: true, sessionManager: { getBranch: () => entries },
    ui: {
      notify(message: string) { throw new Error(message); },
      onTerminalInput(listener: (data: string) => undefined) { listeners.add(listener); return () => listeners.delete(listener); },
      addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) { providerFactory = factory; },
      custom(factory: (tui: TUI, theme: Theme, keys: never, done: (value?: string) => void) => View) {
        const result = Promise.withResolvers<string | undefined>();
        const previous = active;
        if (previous) previous.focused = false;
        let component: View;
        const done = (value?: string) => {
          component.dispose?.(); active = previous;
          if (previous) previous.focused = true;
          result.resolve(value);
        };
        component = factory(tui, getThemeByName("dark")!, undefined as never, done);
        active = component; component.focused = true;
        return result.promise;
      },
    },
  } as unknown as ExtensionContext;
  const pi = {
    on(name: string, callback: (event: unknown, ctx: ExtensionContext) => unknown) { events.set(name, callback); },
    registerCommand(name: string, command: { handler(args: string, ctx: ExtensionContext): Promise<void>; getArgumentCompletions(args: string): unknown }) { commands.set(name, command); },
    registerShortcut(name: string, shortcut: unknown) { shortcuts.set(name, shortcut); },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
  } as unknown as ExtensionAPI;
  piView(pi);
  events.get("session_start")!({}, context);
  t.after(async () => {
    events.get("session_shutdown")!({}, context);
    await rm(cwd, { recursive: true, force: true });
  });
  return { cwd, context, commands, shortcuts, entries, listeners, active: () => active, provider: () => providerFactory };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await delay(10);
  assert.ok(predicate());
}

test("Both empty commands open Quick Open, and Cmd+P layers it over a preview", async t => {
  const app = await host(t);
  assert.ok(app.shortcuts.has("super+p"));
  for (const name of ["view", "v"]) {
    const pending = app.commands.get(name)!.handler("", app.context);
    assert.ok(app.active() instanceof QuickOpen);
    app.active()!.handleInput!("\x1b"); await pending;
  }
  const path = join(app.cwd, "code.ts"); await writeFile(path, "const preview = true;");
  const pending = app.commands.get("view")!.handler(path, app.context);
  await until(() => app.active() instanceof PreviewViewer);
  const preview = app.active();
  let consumed = false;
  for (const listener of app.listeners) if (listener("\x1b[112;9u")?.consume) { consumed = true; break; }
  assert.ok(consumed);
  assert.ok(app.active() instanceof QuickOpen);
  assert.equal(preview!.focused, false);
  app.active()!.handleInput!("\x1b"); await delay(0);
  assert.equal(app.active(), preview);
  assert.equal(preview!.focused, true);
  assert.deepEqual(app.entries, [{ type: "custom", customType: "pi-view-open", data: { path } }]);
  app.active()!.handleInput!("\x1b"); await pending;
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
