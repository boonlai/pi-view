import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CURSOR_MARKER, type TUI, type TuiInputListener } from "@earendil-works/pi-tui";
import { NvimEditor } from "../src/nvim.ts";
import { PreviewViewer } from "../src/viewer.ts";

// Genuine end-to-end coverage against the real Neovim binary: the viewer
// edit round trip (:w exact bytes, literal typed notation, :q back to the
// refreshed preview), the native dirty refusal and explicit discard, and
// recoverable swap state after a forced teardown. Skips only when no nvim
// is on PATH (CI installs one); behavior is identical across platforms.

initTheme("dark", false);
const theme = getThemeByName("dark")!;

const nvimProbe = spawnSync("nvim", ["--version"], { encoding: "utf8", timeout: 5000 });
const haveNvim = (nvimProbe.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
if (haveNvim) assert.equal(nvimProbe.status, 0, nvimProbe.error?.message ?? nvimProbe.stderr);

// Every temp directory this file creates is owned by the file-level after
// hook below, never by per-test hooks. The native Neovim child runs with
// its working directory inside a fixture dir, and Windows keeps that
// directory handle open until the child is fully reaped — dispose() only
// schedules the SIGTERM/SIGKILL timers, and per-test t.after hooks run
// FIFO ahead of the dispose hook, so an rmdir there races the still-live
// child and fails with EBUSY. Per-test hooks therefore only restore
// environment state; deletion waits here, after every per-test dispose
// has drained, with fs.rm's bounded EBUSY retry backoff absorbing the
// asynchronous native teardown.
const ownedDirs: string[] = [];

after(async () => {
  const failures: Array<{ dir: string; error: unknown }> = [];
  for (const dir of ownedDirs.reverse()) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      failures.push({ dir, error });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures.map(failure => failure.error),
      `owned temp directories survived cleanup: ${failures.map(failure => failure.dir).join(", ")}`);
  }
});

// Isolate every Neovim child from the real user state: HOME and the XDG
// roots move into a temp dir for the duration of the test, so anything
// Neovim writes — above all its swap files — lands in state the test owns
// and the file-level after hook removes. The app directory under those
// roots is platform-specific (Windows resolves nvim state under
// LOCALAPPDATA with an nvim-data suffix), so that root is isolated too
// and recovery scans the whole tree instead of assuming a layout.
// childEnv snapshots that isolation for explicitly spawned siblings such as
// the recovery Neovim, which must share the swap location.
function isolateNvimState(t: { after(callback: () => unknown): void }): { stateRoot: string; childEnv: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "pi-view-nvim-home-"));
  ownedDirs.push(root);
  const restore: Record<string, string | undefined> = {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    NVIM_APPNAME: process.env.NVIM_APPNAME,
  };
  Object.assign(process.env, {
    HOME: root, USERPROFILE: root,
    XDG_CONFIG_HOME: join(root, "xdg-config"), XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_DATA_HOME: join(root, "xdg-data"), XDG_STATE_HOME: join(root, "xdg-state"),
    LOCALAPPDATA: join(root, "appdata-local"),
    NVIM_APPNAME: "nvim",
  });
  t.after(() => {
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return { stateRoot: root, childEnv: { ...process.env } };
}

function stubTui(): { tui: TUI; listeners: Set<TuiInputListener> } {
  const listeners = new Set<TuiInputListener>();
  const terminal = { rows: 18, columns: 72, write: () => {} };
  const tui = {
    terminal, mode: "regular", requestRender() {},
    addInputListener(listener: TuiInputListener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as unknown as TUI;
  return { tui, listeners };
}

function type(viewer: PreviewViewer, keys: string): void {
  for (const char of keys) viewer.handleInput(char);
}

// Visible preview text. The grid embeds pi-tui's invisible cursor marker
// mid-content wherever the Neovim cursor sits (typically inside freshly
// typed text), and the marker survives ANSI stripping — drop it explicitly
// so content assertions match what a reader sees.
function screen(viewer: PreviewViewer): string {
  return stripVTControlCharacters(viewer.render(72).join("\n")).split(CURSOR_MARKER).join("");
}

async function until(predicate: () => boolean | Promise<boolean>, message: string | (() => string), budget = 5_000): Promise<void> {
  const deadline = Date.now() + budget;
  while (Date.now() < deadline && !(await predicate())) await delay(25);
  if (!(await predicate())) assert.fail(typeof message === "function" ? message() : message);
}

// Fixture files live in their own temp dir; its deletion belongs to the
// file-level after hook (the native child's cwd sits inside it on Windows).
async function makeFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-view-nvim-integration-"));
  ownedDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

// Prove swap recovery the native way: wait for a swap file anywhere inside
// the owned state root (the app directory under it is platform-specific, so
// scan recursively instead of guessing the layout), then a fresh Neovim
// sharing that state recovers the buffer through :recover.
async function recoverSwap(stateRoot: string, childEnv: NodeJS.ProcessEnv, path: string): Promise<string> {
  let swapPath: string | undefined;
  await until(async () => {
    const entries = await readdir(stateRoot, { recursive: true, withFileTypes: true }).catch(() => []);
    swapPath = entries.find(entry => entry.isFile() && /\.sw[a-p]$/.test(entry.name))?.parentPath;
    return swapPath !== undefined;
  }, "the swap file exists in the isolated state root");
  assert.ok(swapPath, "swap file resolved");
  const recovered = `${path}.recovered`;
  const rec = spawnSync("nvim",
    ["-u", "NONE", "-i", "NONE", "-es", "-c", "silent! recover", "-c", `silent! w! ${recovered}`, "-c", "qa!", path],
    { encoding: "utf8", timeout: 15_000, env: childEnv, windowsHide: true });
  assert.equal(rec.status, 0, `native recovery failed: ${rec.stderr || rec.stdout}`);
  return readFile(recovered, "utf8");
}

test(":w saves exact buffer bytes and :q returns to the refreshed preview", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("doc.txt", "line one\n");
  const { tui } = stubTui();
  let closes = 0;
  const viewer = new PreviewViewer(tui, theme, () => { closes++; }, path);
  viewer.focused = true;
  t.after(() => viewer.dispose());
  await until(() => screen(viewer).includes("line one"), "the preview shows the file");
  viewer.handleInput("e");
  // The status footer replaces "Starting Neovim…" only once onReady fired;
  // typing any earlier is racy — native Neovim may drop input that arrives
  // while startup is still paused (verified against nvim 0.12.5).
  await until(() => screen(viewer).includes(":w save"), "the editor session owns the preview body", 10_000);
  type(viewer, "Aappended by nvim");
  type(viewer, "<Esc>"); // typed literally: must become buffer text, not Escape
  type(viewer, "\x1b"); // a real Escape byte belongs to Neovim and leaves insert
  await until(() => screen(viewer).includes("appended by nvim"), "the inserted text renders in the embedded editor", 10_000);
  // Host-initiated close is refused while any session runs.
  assert.equal(viewer.requestClose(), false);
  type(viewer, ":w\r");
  await until(async () => (await readFile(path, "utf8")) === "line oneappended by nvim<Esc>\n",
    ":w persists the exact buffer bytes including the literal <Esc>", 10_000);
  type(viewer, ":q\r");
  await until(() => !viewer.editing, ":q ends the editor session");
  await until(() => screen(viewer).includes("appended by nvim"), "the restored preview reloads the saved file");
  assert.equal(closes, 0, ":q returns to the preview instead of closing it");
});

test("dirty :q is refused by Neovim and :q! discards without touching disk", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("code.js", "original\n");
  const exits: string[] = [];
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: reason => { exits.push(reason); },
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  // Typing reaches the real buffer; the escape byte is Neovim's, not text.
  editor.input("Achanged locally\x1b");
  await until(() => editor.dirty, "the edit marks the buffer dirty");
  editor.input(":q\r");
  await delay(600); // a wrong immediate exit would surface within this window
  assert.ok(editor.running, "dirty :q must not exit");
  assert.deepEqual(exits, []);
  editor.input(":q!\r");
  await until(() => !editor.running, ":q! exits");
  await until(() => exits.length === 1 && exits[0] === "quit", "the discard quit surfaces as a user quit");
  assert.equal(await readFile(path, "utf8"), "original\n", "discarding leaves the file untouched");
});

test("bracketed paste reaches the buffer verbatim: NUL kept, CRLF normalized", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("pasted.txt", "line one\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input("A"); // insert at end of the line, the usual paste target
  editor.input("\x1b[200~nul\x00crlf\r\nsecond\x1b[201~");
  await until(() => editor.dirty, "the pasted content marks the buffer dirty");
  // A terminal paste lands in insert mode; leaving it is the user's Esc.
  editor.input("\x1b");
  editor.input(":w\r");
  await until(() => !editor.dirty, "saving clears the dirty flag", 10_000);
  assert.equal(await readFile(path, "utf8"), "line onenul\x00crlf\nsecond\n",
    ":w persists the pasted NUL byte and Neovim's own CRLF normalization");
});

test("a refused paste is echoed visibly and does not end the session", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("locked.txt", "read only\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input(":setlocal nomodifiable\r");
  await delay(500); // let the option land before attempting the paste
  editor.input("\x1b[200~blocked\x1b[201~");
  // The native grid never shows RPC errors on its own; the session must
  // echo the refusal (E21) so the paste failure is not silent.
  await until(() => editor.render(true).rows.some(row => row.includes("E21")),
    "the refused paste is echoed into the editor screen", 5_000);
  assert.ok(editor.running, "the rejected paste must not end the session");
  assert.equal(editor.dirty, false, "the locked buffer stays unmodified");
  assert.equal(await readFile(path, "utf8"), "read only\n");
  // The echoed refusal must not wedge the session: unlock and edit again.
  editor.input(":setlocal modifiable\r");
  editor.input("Aok"); // append at end of line, not insert at column 0
  await until(() => editor.dirty, "the session edits again after the refusal");
  assert.ok(editor.render(true).rows.map(row => stripVTControlCharacters(row).split(CURSOR_MARKER).join(""))
    .some(row => row.includes("read onlyok")), "the unlocked buffer accepts input after the echoed refusal");
});

test("forced teardown keeps unsaved edits recoverable through native nvim -r", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  const { stateRoot, childEnv } = isolateNvimState(t);
  const path = await makeFile("notes.txt", "base\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input("ASWAP_MARKER_9137\x1b");
  await until(() => editor.dirty, "the unsaved edit registered");
  editor.dispose();
  // dispose preserves the swap, then stops the child with bounded kills
  // (SIGTERM after 150ms, SIGKILL 250ms later); let that window elapse
  // before the recovery probe.
  await delay(600);
  const recoveredContent = await recoverSwap(stateRoot, childEnv, path);
  assert.ok(recoveredContent.includes("SWAP_MARKER_9137"), "native :recover restores the unsaved edits");
  assert.equal(await readFile(path, "utf8"), "base\n", "recovery never touches the real file");
});

test("teardown while input is in flight delivers queued keys exactly once", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  const { stateRoot, childEnv } = isolateNvimState(t);
  const path = await makeFile("stream.txt", "head\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input("A-one\x1b");
  await until(() => editor.dirty, "the settled edit registered");
  // input() has already written this frame to Neovim synchronously; the
  // response is still pending, so dispose() must not flush it a second time.
  editor.input("A-two");
  editor.dispose();
  await delay(600);
  // The preserve RPC runs after any flushed input, so the swap reflects
  // exactly what Neovim received: "-two" appended once, never duplicated.
  const recoveredContent = await recoverSwap(stateRoot, childEnv, path);
  assert.equal(recoveredContent, "head-one-two\n",
    "recovery shows each in-flight keystroke batch exactly once");
});

test("markdown previews round-trip an edit through Neovim", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("doc.md", "# Title\n\nbody line\n");
  const marker = await makeFile("user-plugin.txt", "");
  const packageDir = join(process.env.XDG_CONFIG_HOME!, "nvim", "pack", "probe", "start", "probe", "ftplugin");
  await mkdir(packageDir, { recursive: true });
  // --noplugin alone does not exclude package-provided filetype plugins.
  await writeFile(join(packageDir, "markdown.lua"),
    `vim.fn.writefile({"user plugin executed"}, ${JSON.stringify(marker)})\n`);
  const { tui } = stubTui();
  let closes = 0;
  const viewer = new PreviewViewer(tui, theme, () => { closes++; }, path);
  viewer.focused = true;
  t.after(() => viewer.dispose());
  await until(() => screen(viewer).includes("body line"), "the rendered markdown preview shows the file");
  viewer.handleInput("e");
  await until(() => screen(viewer).includes(":w save"), "the editor session owns the preview body", 10_000);
  type(viewer, "GA more\x1b");
  await until(() => screen(viewer).includes("body line more"),
    () => `the inserted text renders in the markdown buffer\ncurrent preview screen:\n${screen(viewer)}`, 10_000);
  type(viewer, ":w\r");
  await until(async () => (await readFile(path, "utf8")) === "# Title\n\nbody line more\n",
    ":w persists the markdown buffer exactly", 10_000);
  assert.equal(await readFile(marker, "utf8"), "", "user package plugins stay outside the isolated runtime");
  type(viewer, ":q\r");
  await until(() => !viewer.editing, ":q ends the editor session");
  await until(() => screen(viewer).includes("body line more"), "the rendered preview reloads the saved markdown");
  assert.equal(closes, 0, ":q returns to the preview instead of closing it");
});

test("literal and Kitty keys preserve text and native modified-Space behavior", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("keys.txt", "seed\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input("A");
  editor.input("+"); // literal printable must not be eaten as notation
  editor.input("\x1b[59:58;2u"); // Kitty shifted semicolon key is the colon
  editor.input("\x1b[233u"); // Kitty e-acute (U+00E9)
  editor.input("\x1b");
  editor.input(":w\r");
  await until(async () => (await readFile(path, "utf8")) === "seed+:\u00e9\n",
    "the literal and Kitty edits have been saved", 10_000);
  assert.equal(await readFile(path, "utf8"), "seed+:\u00e9\n",
    "literal and Kitty printable keys reach the file byte-exactly");
  editor.input("A\x1b[32;5u:w\r");
  await until(async () => (await readFile(path, "utf8")) === "seed+:\u00e9+:\u00e9\n",
    "Kitty Ctrl-Space repeats the previous insertion and leaves insert mode", 10_000);
});

test("a ten-thousand e-acute key burst saves byte-exactly", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("burst.txt", "seed\n");
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  const burst = "A" + "\u00e9".repeat(10_000) + "\x1b";
  editor.input(burst);
  await until(() => editor.dirty, "the burst marks the buffer dirty", 30_000);
  editor.input(":w\r");
  await until(async () => (await readFile(path, "utf8")) === "seed" + "\u00e9".repeat(10_000) + "\n",
    "the whole burst reaches the file exactly once", 60_000);
  await until(() => !editor.dirty, "the native save notification clears the modified state");
});

test("native More pager interaction stays ordered with paste bursts", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("paged.txt", "line one\n");
  const exits: string[] = [];
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: (reason, detail) => { exits.push(detail ? `${reason}: ${detail}` : reason); },
  });
  editor.start();
  t.after(() => editor.dispose());
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input(":set all\r");
  await until(() => editor.render(true).rows.some(row => row.includes("More")),
    "the options pager is on screen", 10_000);
  editor.input("\x1b[200~PAGER-PASTE\x1b[201~"); // arrives while the pager holds the screen
  editor.input("q");
  await until(() => !editor.render(true).rows.some(row => row.includes("More")),
    "the pager was dismissed and editing resumes", 10_000);
  assert.ok(editor.running, "the pager detour must not end the session");
  // A normal burst after the detour must run in order: clear line, paste
  // tail, leave insert, write and quit.
  editor.input("ccREWRITTEN\x1b[200~TAIL\x1b[201~\x1b:wq\r");
  await until(() => !editor.running, ":wq ends the session", 30_000);
  await until(() => exits.length === 1 && exits[0] === "quit",
    () => `the write-quit surfaces as a user quit\nonExit reasons: ${JSON.stringify(exits)}\nnative rows:\n${
      editor.render(true).rows.map(row => stripVTControlCharacters(row).split(CURSOR_MARKER).join("")).join("\n")}`);
  assert.equal(await readFile(path, "utf8"), "REWRITTENTAIL\n",
    "the post-pager burst applies keys and paste in order");
});

test("Ctrl-C interrupts a busy native command without killing the editor", { timeout: 20_000 }, async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("interrupt.txt", "seed\n");
  const marker = await makeFile("busy.txt", "");
  let exit: string | undefined;
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: reason => { exit = reason; },
  });
  t.after(() => editor.dispose());
  editor.start();
  await until(() => editor.ready, "embedded Neovim became ready", 10_000);
  editor.input(`:call writefile(['busy'], '${marker.replace(/'/g, "''")}') | while 1 | endwhile\r`);
  await until(async () => (await readFile(marker, "utf8")) === "busy\n",
    "the native command reached its busy loop", 10_000);
  editor.input("\x03:q\r");
  await until(() => exit === "quit", "Ctrl-C interrupts the loop and native :q still works", 10_000);
  assert.equal(await readFile(path, "utf8"), "seed\n");
});

test("rapid resize reversals converge on the latest native grid width", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("resize.txt", "seed\n");
  const editor = new NvimEditor(path, {
    cols: 80, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: () => {},
  });
  t.after(() => editor.dispose());
  editor.start();
  await until(() => editor.render(false).rows.some(row => row.includes("seed")),
    "the initial native buffer has rendered", 10_000);
  editor.resize(100, 12);
  editor.resize(80, 12);
  editor.input("ARESIZED\x1b");
  await until(() => {
    const rows = editor.render(false).rows.map(row => stripVTControlCharacters(row));
    return rows.some(row => row.includes("seedRESIZED"))
      && rows.length === 12 && rows.every(row => row.length === 80);
  }, "subsequent native editing renders at the final requested dimensions", 10_000);
});

test("an unexpected native process death is not a successful quit", async t => {
  if (!haveNvim) { t.skip("nvim is not on PATH"); return; }
  isolateNvimState(t);
  const path = await makeFile("crash.txt", "seed\n");
  let child: ChildProcess | undefined;
  let reason: string | undefined;
  const editor = new NvimEditor(path, {
    cols: 72, rows: 12,
    onReady: () => {},
    onFlush: () => {},
    onError: () => {},
    onExit: value => { reason = value; },
  }, (command, args, options) => {
    child = spawn(command, args, options);
    return child;
  });
  t.after(() => editor.dispose());
  editor.start();
  await until(() => editor.render(false).rows.some(row => row.includes("seed")),
    "the native file is visible before the process failure", 10_000);
  child!.kill("SIGKILL");
  await until(() => reason === "crashed", "an external process kill reports a crash");
  assert.equal(await readFile(path, "utf8"), "seed\n");
});
