// Path completion and resolution for /view and /v.
//
// The argument grammar is ONE literal path — nothing is executed, globbed, or
// split on whitespace. Quotes group characters: inside double quotes, \" and
// \\ are escapes; single quotes have no escapes. Outside quotes every
// character is literal. Values produced by completePath always roundtrip
// through resolvePath.
import { opendirSync, statSync, type Dirent } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export interface FileEntry {
	name: string;
	path: string;
	directory: boolean;
}

/** Upper bound on completions returned by completePath. */
export const MAX_COMPLETIONS = 500;
/** Upper bound on entries returned by listDirectory. */
// Cap keeps giant dirs from flooding the picker; raise or paginate in the picker if ever hit.
export const MAX_LIST_ENTRIES = 10_000;

type ParsedArg = { logical: string; flag: boolean; url: boolean };

function parseArg(raw: string): ParsedArg {
	const s = raw.replace(/^\s+/, "");
	let logical = "";
	let quote: string | null = null;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote === "'") {
			if (c === "'") quote = null;
			else logical += c;
		} else if (quote === '"') {
			if (c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) logical += s[++i];
			else if (c === '"') quote = null;
			else logical += c;
		} else if (c === '"' || c === "'") {
			quote = c;
		} else {
			logical += c;
		}
	}
	return { logical, flag: s.startsWith("-"), url: /^[\w+.-]+:\/\//.test(logical) };
}

function expandHome(value: string): string {
	if (value === "~") return homedir();
	return value.startsWith("~/") || (path.sep === "\\" && value.startsWith("~\\"))
		? path.join(homedir(), value.slice(2)) : value;
}


/** Expand ~ and quotes and resolve against cwd. Throws on empty args, flags, and URLs. */
export function resolvePath(args: string, cwd: string): string {
	const { logical, flag, url } = parseArg(args);
	if (logical === "") throw new Error("no path given");
	if (flag) throw new Error(`flags are not supported: ${args.trim()}`);
	if (url) throw new Error(`URLs are not supported: ${args.trim()}`);
	return path.resolve(cwd, expandHome(logical));
}

function byDirThenName(
	a: { name: string; directory: boolean },
	b: { name: string; directory: boolean },
): number {
	if (a.directory !== b.directory) return a.directory ? -1 : 1;
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Synchronous completion over the full (single-path) argument string.
 * Returns items whose `value` replaces the whole argument; directory values
 * end in "/" (quote left open when quoting) so the next completion descends.
 * Null when the target directory is missing/unreadable or nothing matches.
 */
export function completePath(args: string, cwd: string): AutocompleteItem[] | null {
	const { logical, flag, url } = parseArg(args);
	if (flag || url) return null;

	const tilde = logical === "~" || logical.startsWith("~/") || (path.sep === "\\" && logical.startsWith("~\\"));
	const sep = Math.max(logical.lastIndexOf("/"), path.sep === "\\" ? logical.lastIndexOf("\\") : -1);
	let dirLogical: string;
	let base: string;
	if (tilde && sep <= 1) {
		dirLogical = "~";
		base = sep === -1 ? "" : logical.slice(2);
	} else if (sep === -1) {
		dirLogical = path.sep === "\\" && /^[A-Za-z]:/.test(logical) ? logical.slice(0, 2) : "";
		base = logical.slice(dirLogical.length);
	} else {
		dirLogical = logical.slice(0, sep + 1);
		base = logical.slice(sep + 1);
	}

	const dirAbs = path.resolve(cwd, expandHome(dirLogical));
	let dirents: Dirent[] = [];
	try {
		const directory = opendirSync(dirAbs);
		try {
			for (let i = 0; i < MAX_LIST_ENTRIES; i++) {
				const entry = directory.readSync();
				if (!entry) break;
				dirents.push(entry);
			}
		} finally { directory.closeSync(); }
	} catch {
		return null; // nonexistent, unreadable, or not a directory
	}

	const showHidden = base.startsWith(".");
	const foldedBase = base.toLowerCase();
	const head = sep === -1 ? (tilde ? "~/" : dirLogical) : logical.slice(0, sep + 1);
	const rows: { name: string; directory: boolean; value: string; label: string }[] = [];
	for (const d of dirents) {
		if (/[\x00-\x1f\x7f-\x9f]/.test(d.name)) continue;
		if (!d.name.toLowerCase().startsWith(foldedBase)) continue;
		if (!showHidden && d.name.startsWith(".")) continue;
		let directory = d.isDirectory();
		if (!directory && d.isSymbolicLink()) {
			try {
				directory = statSync(path.join(dirAbs, d.name)).isDirectory();
			} catch {
				// broken symlink: complete as a file
			}
		}
		rows.push({
			name: d.name,
			directory,
			value: serializeValue(!head && !tilde && d.name === "~" ? "./~" : head + d.name, directory),
			label: d.name + (directory ? "/" : ""),
		});
		if (rows.length >= MAX_COMPLETIONS) break;
	}
	if (rows.length === 0) return null;
	rows.sort(byDirThenName);
	return rows.map(({ value, label }) => ({ value, label }));
}

// Values replace the entire argument in the editor, so they carry their own
// quoting: quote whenever the path contains whitespace or a double quote.
export function serializeValue(full: string, directory = false): string {
	const withSep = directory && !full.endsWith("/") && !(path.sep === "\\" && full.endsWith("\\"))
		? `${full}/` : full;
	if (!/[\s"']/.test(withSep) && !withSep.startsWith("-")) return withSep;
	return `"${withSep.replace(/[\\"]/g, "\\$&")}${directory ? "" : '"'}`;
}

/** Bounded async listing for the picker: directories first, names sorted. */
export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
	const rows: FileEntry[] = [];
	for await (const entry of await opendir(dirPath)) {
		const full = path.join(dirPath, entry.name);
		const directory = entry.isDirectory() || (entry.isSymbolicLink() && await stat(full).then(info => info.isDirectory(), () => false));
		rows.push({ name: entry.name, path: full, directory });
		if (rows.length >= MAX_LIST_ENTRIES) break;
	}
	rows.sort(byDirThenName);
	return rows;
}

