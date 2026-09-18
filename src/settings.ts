// Persistent viewer preference for pi-view.
//
// One user preference exists today (source line numbers). It lives in a small
// JSON file under the user's config directory so it survives file switches,
// new viewer instances and host restarts without touching Pi or OMP settings.
// Reads happen when a viewer opens; writes are coalesced, atomic (temp file +
// rename) and best-effort — a preference I/O failure must never break or delay
// previewing, so every error falls back to the default (off). Concurrent
// hosts converge by last-writer-wins; a rename never exposes partial JSON.
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Coalescing window so a burst of toggles becomes one disk write. */
const SAVE_DELAY_MS = 250;

let stateFile: string | undefined;
let pendingValue: boolean | undefined;
let saveTimer: NodeJS.Timeout | undefined;

/** Preference file location; honors XDG_CONFIG_HOME, then APPDATA, then HOME. */
export function getStateFile(): string {
  const root = process.env.XDG_CONFIG_HOME?.trim() || process.env.APPDATA?.trim() || join(homedir(), ".config");
  return stateFile ?? join(root, "pi-view", "settings.json");
}

/** Point the preference file at an isolated location (tests, sandboxes). */
export function setStateFile(file: string): void {
  flushLineNumbersSave();
  stateFile = file;
}

/** Drop any override after flushing; restores the computed default location. */
export function resetStateFile(): void {
  flushLineNumbersSave();
  stateFile = undefined;
}

/** Persisted line-number preference; any read failure means the default (off). */
export function readLineNumbers(file = getStateFile()): boolean {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { lineNumbers?: unknown };
    return parsed.lineNumbers === true;
  } catch {
    return false;
  }
}

/** Atomic single write; throws so callers decide how to surface failures. */
export function writeLineNumbers(file: string, value: boolean): void {
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true });
  const temp = join(directory, `.${basename(file)}.${process.pid}.${randomInt(1_000_000_000)}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify({ lineNumbers: value })}\n`);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Queue a preference save; rapid toggles collapse into one atomic write. */
export function queueLineNumbersSave(value: boolean): void {
  pendingValue = value;
  saveTimer ??= setTimeout(flushLineNumbersSave, SAVE_DELAY_MS);
  saveTimer.unref();
}

/** Write any queued preference change now; safe and side-effect free when idle. */
export function flushLineNumbersSave(): void {
  const value = pendingValue;
  pendingValue = undefined;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (value === undefined) return;
  try {
    writeLineNumbers(getStateFile(), value);
  } catch { /* best effort: keep previewing without the preference. */ }
}
