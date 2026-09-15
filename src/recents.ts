// Recent-file extraction for Quick Open.
//
// Scans session branch entries (oldest→newest input, processed newest-first)
// for filesystem mentions: structured toolCall arguments, pi-view-open custom
// entries, and message text (backticks, quotes, Markdown links, bare tokens).
// Candidates resolve against cwd, must be existing regular files (contents are
// never read), and deduplicate by realpath while keeping the newest mention's
// absolute form. Pure fs — no shell.
import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

/** Maximum number of recent files returned (Quick Open page size). */
export const MAX_RECENT_FILES = 20;
/** Newest branch entries considered; deeper history is out of scope for recents. */
export const MAX_ENTRIES = 2000;
/** Mentions inspected per call — bounds stat/realpath work. */
export const MAX_CANDIDATES = 1000;
/** Characters of text scanned per blob (message text, command, output, summary). */
export const MAX_TEXT_CHARS = 262_144;
/** Object nesting followed inside toolCall arguments. */
const MAX_ARG_DEPTH = 2;
/** Array elements inspected per toolCall argument value. */
const MAX_ARRAY_ITEMS = 64;
/** toolCall argument keys that carry a filesystem path. */
const ARG_KEYS = ["path", "file", "filePath", "file_path"] as const;

/** customType of the extension entry appended when a file is previewed. */
const VIEW_OPEN_TYPE = "pi-view-open";

// One pass over text: Markdown link href, backticks, quoted strings, bare tokens.
const MENTION_RE =
	/\[[^[\]\n]*\]\(([^()\s]+)\)|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s'"`()[\]<>|,;]+)/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>'"]/;
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,11}$/;

// Peel selectors from the right without overlapping regex alternatives.
function cleanMention(raw: string): string {
	const text = raw.trim();
	let cursor = text.length;
	while (cursor > 0 && TRAILING_PUNCT_RE.test(text[cursor - 1])) cursor--;
	let cut = cursor;
	while (cursor > 0) {
		const end = cursor;
		while (cursor > 0 && text.charCodeAt(cursor - 1) >= 48 && text.charCodeAt(cursor - 1) <= 57) cursor--;
		if (cursor === end) break;
		if (text[cursor - 1] === "L") cursor--;
		const separator = text[cursor - 1];
		if (separator === ":" || separator === "#") cut = --cursor;
		else if (separator === "-") cursor--;
		else break;
	}
	while (cut > 0 && TRAILING_PUNCT_RE.test(text[cut - 1])) cut--;
	return text.slice(0, cut).trim();
}

/** Mentions found in one text blob, in occurrence order (cleaned, deduped later). */
function scanTextMentions(text: string, out: string[]): void {
	if (text.length > MAX_TEXT_CHARS) text = text.slice(-MAX_TEXT_CHARS);
	for (const m of text.matchAll(MENTION_RE)) {
		const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
		if (raw === undefined) continue;
		const s = cleanMention(raw);
		if (s === "") continue;
		// Bare tokens must look path-like (no flags); quoted/backticked spans are trusted.
		const bare = m[5] !== undefined;
		if (bare && (s.startsWith("-") || (!/[\\/]/.test(s) && !EXT_RE.test(s)))) continue;
		out.push(s);
	}
}
function argMentions(args: unknown, depth: number, out: string[]): void {
	if (depth > MAX_ARG_DEPTH || typeof args !== "object" || args === null || Array.isArray(args)) return;
	const obj = args as Record<string, unknown>;
	for (const key of ARG_KEYS) {
		const v = obj[key];
		if (typeof v === "string") out.push(v);
		else if (Array.isArray(v)) {
			const items = v.length > MAX_ARRAY_ITEMS ? v.slice(0, MAX_ARRAY_ITEMS) : v;
			for (const item of items) {
				if (typeof item === "string") out.push(item);
				else argMentions(item, depth + 1, out);
			}
		} else if (typeof v === "object" && v !== null) argMentions(v, depth + 1, out);
	}
}

function pushContentMentions(content: unknown, out: string[]): void {
	if (typeof content === "string") {
		scanTextMentions(content, out);
		return;
	}
	if (!Array.isArray(content)) return;
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const b = block as Record<string, unknown>;
		if (b.type === "toolCall") argMentions(b.arguments, 0, out);
		else if (typeof b.text === "string") scanTextMentions(b.text, out);
	}
}

/**
 * Mentions of one entry, last mention first (newest rank within the entry).
 * Unknown entry types and other extensions' custom data are ignored — never
 * traversed — so arbitrary session payloads stay out of the hot path.
 */
function entryMentions(entry: unknown): string[] {
	if (typeof entry !== "object" || entry === null) return [];
	const e = entry as Record<string, unknown>;
	if (e.type === "custom") {
		if (e.customType !== VIEW_OPEN_TYPE) return [];
		const data = e.data;
		const p = typeof data === "object" && data !== null ? (data as Record<string, unknown>).path : undefined;
		return typeof p === "string" ? [p] : [];
	}
	if (e.type === "compaction" || e.type === "branch_summary") {
		const out: string[] = [];
		if (typeof e.summary === "string") scanTextMentions(e.summary, out);
		return out.reverse();
	}
	if (e.type !== "message") return [];
	const msg = e.message;
	if (typeof msg !== "object" || msg === null) return [];
	const m = msg as Record<string, unknown>;
	const out: string[] = [];
	if (typeof m.command === "string") scanTextMentions(m.command, out);
	if (typeof m.output === "string") scanTextMentions(m.output, out);
	if (typeof m.fullOutputPath === "string") out.push(m.fullOutputPath);
	pushContentMentions(m.content, out);
	return out.reverse();
}

/**
 * Resolve a candidate after optional mention cleanup. Nonlocal URI schemes
 * are not filesystem fallbacks; Windows drive paths retain their colons.
 */
function toAbsolutePath(raw: string, cwd: string): string | null {
	const s = raw;
	if (s === "") return null;
	if (WIN_DRIVE_RE.test(s)) return path.resolve(s);
	const scheme = SCHEME_RE.exec(s);
	if (scheme) {
		const name = scheme[0].slice(0, -1).toLowerCase();
		if (name === "file") {
			try {
				return fileURLToPath(s);
			} catch {
				return null;
			}
		}
		// Single-letter "schemes" are drive-relative paths, not URLs.
		if (name.length === 1) return path.resolve(cwd, s);
		return null; // http(s), data:, memory://, … — nonlocal
	}
	const expanded = s === "~" ? homedir() : s.startsWith("~/") ? path.join(homedir(), s.slice(2)) : s;
	return path.resolve(cwd, expanded);
}

/**
 * Newest-first list of existing regular files mentioned in session entries.
 *
 * Walks the branch newest→oldest (entries are oldest→newest), taking a
 * message's last mention before its earlier ones, and stops at 20 distinct
 * files. Identity is realpath; the displayed path is the newest mention's
 * absolute form.
 */
export async function recentFiles(entries: readonly unknown[], cwd: string): Promise<string[]> {
	const out: string[] = [];
	const seenForms = new Map<string, boolean>();
	const seenReal = new Set<string>();
	let budget = MAX_CANDIDATES;
	const start = Math.max(0, entries.length - MAX_ENTRIES);
	for (let i = entries.length - 1; i >= start; i--) {
		const entry = entries[i] as { type?: string; customType?: string } | null;
		const exact = entry?.type === "custom" && entry.customType === VIEW_OPEN_TYPE;
		for (const raw of entryMentions(entry)) {
			// Our own records are exact filesystem paths. Tool arguments prefer
			// an existing literal path before interpreting punctuation/selectors.
			const literal = exact || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)
				? path.resolve(cwd, raw) : toAbsolutePath(raw, cwd);
			const forms = exact ? [literal] : [literal, toAbsolutePath(cleanMention(raw), cwd)];
			for (const abs of forms) {
				if (abs === null) continue;
				if (seenForms.has(abs)) {
					if (seenForms.get(abs)) break;
					continue;
				}
				if (budget-- <= 0) return out;
				let info;
				try { info = await lstat(abs); }
				catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					const missing = code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG";
					seenForms.set(abs, !missing);
					if (!missing) break;
					continue;
				}
				seenForms.set(abs, true);
				if (info.isSymbolicLink()) {
					try { info = await stat(abs); } catch { break; }
				}
				if (!info.isFile()) break;
				const rp = await realpath(abs).catch(() => null);
				if (rp === null) break;
				if (!seenReal.has(rp)) {
					seenReal.add(rp);
					out.push(abs);
					if (out.length >= MAX_RECENT_FILES) return out;
				}
				break;
			}
		}
	}
	return out;
}
