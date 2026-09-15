// Recent-file extraction for Quick Open.
//
// Scans session branch entries (oldest→newest input, processed newest-first)
// for filesystem mentions: structured toolCall arguments, pi-view-open custom
// entries, and message text (backticks, quotes, Markdown links, bare tokens).
// Candidates resolve against cwd, must be existing regular files (contents are
// never read), and deduplicate by realpath while keeping the newest mention's
// absolute form. Pure fs — no shell.
import { realpath, stat } from "node:fs/promises";
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
	/\[[^\]\n]*\]\(([^()\s]+)\)|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s'"`()[\]<>|,;]+)/g;
// Trailing line/anchor selectors: :42, :42-47, :42:7, #L42, #L42-L50, #42.
const LINE_SUFFIX_RE = /(?:[:#]L?\d+(?::\d+)?(?:-L?\d+)*)+$/;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>'"]+$/;
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,11}$/;

/** Mentions found in one text blob, in occurrence order (cleaned, deduped later). */
function scanTextMentions(text: string, out: string[]): void {
	if (text.length > MAX_TEXT_CHARS) text = text.slice(-MAX_TEXT_CHARS);
	for (const m of text.matchAll(MENTION_RE)) {
		const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
		if (raw === undefined) continue;
		const s = raw.replace(TRAILING_PUNCT_RE, "").replace(LINE_SUFFIX_RE, "").replace(TRAILING_PUNCT_RE, "").trim();
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
 * Clean one mention and resolve it to an absolute path against cwd. Returns
 * null for nonlocal schemes (anything but file://), empty strings, and the
 * like; Windows drive colons survive because line suffixes require digits.
 */
function toAbsolutePath(raw: string, cwd: string): string | null {
	const s = raw.replace(TRAILING_PUNCT_RE, "").replace(LINE_SUFFIX_RE, "").replace(TRAILING_PUNCT_RE, "").trim();
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
	const seenForms = new Set<string>();
	const seenReal = new Set<string>();
	let budget = MAX_CANDIDATES;
	const start = Math.max(0, entries.length - MAX_ENTRIES);
	for (let i = entries.length - 1; i >= start; i--) {
		for (const raw of entryMentions(entries[i])) {
			const abs = toAbsolutePath(raw, cwd);
			if (abs === null || seenForms.has(abs)) continue;
			seenForms.add(abs);
			if (budget-- <= 0) return out;
			const [st, rp] = await Promise.all([stat(abs).catch(() => null), realpath(abs).catch(() => null)]);
			if (st === null || rp === null || !st.isFile()) continue;
			if (seenReal.has(rp)) continue;
			seenReal.add(rp);
			out.push(abs);
			if (out.length >= MAX_RECENT_FILES) return out;
		}
	}
	return out;
}
