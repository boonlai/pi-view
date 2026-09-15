import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { MAX_RECENT_FILES, recentFiles } from "../src/recents.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "pi-view-recents-"));
const homeTmp = mkdtempSync(path.join(homedir(), "pi-view-recents-home-"));
const F = (name: string) => path.join(tmp, name);

mkdirSync(path.join(tmp, "nested"));
mkdirSync(path.join(tmp, "my docs"));
mkdirSync(path.join(tmp, "fake.dir"));
writeFileSync(path.join(tmp, "nested/alpha.txt"), "a");
writeFileSync(path.join(tmp, "nested/beta.md"), "b");
writeFileSync(path.join(tmp, "plain.txt"), "p");
writeFileSync(path.join(tmp, "README.md"), "r");
writeFileSync(path.join(tmp, "my docs/report final.txt"), "q");
writeFileSync(path.join(tmp, "my docs/notes one.md"), "n");
writeFileSync(path.join(homeTmp, "t.txt"), "h");
symlinkSync(path.join(tmp, "nested/alpha.txt"), path.join(tmp, "alpha-alias.txt"));
for (let i = 0; i < 25; i++) writeFileSync(path.join(tmp, `cap-${String(i).padStart(2, "0")}.txt`), "c");

after(() => {
	rmSync(tmp, { recursive: true, force: true });
	rmSync(homeTmp, { recursive: true, force: true });
});

let seq = 0;
const entry = (extra: Record<string, unknown>) => ({
	id: `e${++seq}`,
	parentId: null,
	timestamp: new Date(Date.UTC(2026, 0, seq)).toISOString(),
	...extra,
});
const userMsg = (text: string) =>
	entry({ type: "message", message: { role: "user", content: text, timestamp: seq } });
const asstMsg = (content: unknown[]) =>
	entry({ type: "message", message: { role: "assistant", content, timestamp: seq } });
const toolResultMsg = (text: string) =>
	entry({
		type: "message",
		message: {
			role: "toolResult",
			toolCallId: "t",
			toolName: "read",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: seq,
		},
	});
const call = (args: unknown) => ({ type: "toolCall", id: "t", name: "read", arguments: args });
const viewOpen = (p?: string) =>
	entry(
		p === undefined
			? { type: "custom", customType: "pi-view-open" }
			: { type: "custom", customType: "pi-view-open", data: { path: p } },
	);

test("files rank newest first, last mention of a message first, repeats deduplicated", async () => {
	const entries = [
		userMsg("looks at plain.txt then nested/alpha.txt"),
		userMsg("now nested/alpha.txt and nested/beta.md"),
	];
	assert.deepEqual(await recentFiles(entries, tmp), [
		F("nested/beta.md"),
		F("nested/alpha.txt"),
		F("plain.txt"),
	]);
});

test("realpath identity dedupes symlinks, keeping the newest representation", async () => {
	const entries = [userMsg(F("nested/alpha.txt")), userMsg("alias alpha-alias.txt")];
	assert.deepEqual(await recentFiles(entries, tmp), [F("alpha-alias.txt")]);
});

test("backticks, quotes with spaces, and Markdown links resolve", async () => {
	const text =
		'see "my docs/report final.txt" and \'my docs/notes one.md\', plus `nested/beta.md` and [guide](README.md)';
	assert.deepEqual(await recentFiles([userMsg(text)], tmp), [
		F("README.md"),
		F("nested/beta.md"),
		F("my docs/notes one.md"),
		F("my docs/report final.txt"),
	]);
});

test("toolCall arguments parse path/file/filePath/file_path, arrays, and nested objects", async () => {
	const msg = asstMsg([
		call({ path: F("nested/alpha.txt") }),
		call({ file_path: F("nested/beta.md") }),
		call({ filePath: F("plain.txt") }),
		call({ file: F("README.md") }),
		call({ file: [F("cap-00.txt"), F("cap-01.txt"), F("cap-02.txt")] }),
		call({ file: { path: F("cap-03.txt") } }),
	]);
	assert.deepEqual(await recentFiles([msg], tmp), [
		F("cap-03.txt"),
		F("cap-02.txt"),
		F("cap-01.txt"),
		F("cap-00.txt"),
		F("README.md"),
		F("plain.txt"),
		F("nested/beta.md"),
		F("nested/alpha.txt"),
	]);
});

test("line and anchor suffixes strip from text mentions", async () => {
	const entries = [
		userMsg("check nested/alpha.txt:42, nested/beta.md#L7-L9, plain.txt:12:3 and README.md:3-5 done"),
	];
	assert.deepEqual(await recentFiles(entries, tmp), [
		F("README.md"),
		F("plain.txt"),
		F("nested/beta.md"),
		F("nested/alpha.txt"),
	]);
});

test("result caps at MAX_RECENT_FILES keeping the newest 20", async () => {
	const entries = [];
	for (let i = 0; i < 25; i++) entries.push(userMsg(`touch cap-${String(i).padStart(2, "0")}.txt`));
	const res = await recentFiles(entries, tmp);
	assert.equal(res.length, MAX_RECENT_FILES);
	assert.equal(res[0], F("cap-24.txt"));
	assert.equal(res[19], F("cap-05.txt"));
});

test("URLs, data and internal URIs, missing files, and directories are skipped", async () => {
	const text =
		"see https://example.com/a.ts and data:text/plain,hi and memory://old/x.ts plus no-such-file.xyz and fake.dir here";
	assert.deepEqual(await recentFiles([userMsg(text)], tmp), []);
});

test("pi-view-open custom entries rank their file newest; other customs are ignored", async () => {
	const entries = [
		userMsg("open nested/alpha.txt"),
		entry({ type: "custom", customType: "other-ext", data: { path: "ghost.txt" } }),
		viewOpen("plain.txt"),
	];
	assert.deepEqual(await recentFiles(entries, tmp), [F("plain.txt"), F("nested/alpha.txt")]);
	assert.deepEqual(await recentFiles([viewOpen()], tmp), []);
});

test("tilde paths expand to the home directory and file:// URLs decode", async () => {
	const url = pathToFileURL(F("my docs/report final.txt")).href;
	const res = await recentFiles([userMsg(`home file ~/${path.basename(homeTmp)}/t.txt and url ${url}`)], tmp);
	assert.deepEqual(res, [F("my docs/report final.txt"), path.join(homeTmp, "t.txt")]);
});

test("tool-result text and assistant text blocks are scanned", async () => {
	const entries = [toolResultMsg("wrote `nested/beta.md` ok"), asstMsg([{ type: "text", text: "edited plain.txt" }])];
	assert.deepEqual(await recentFiles(entries, tmp), [F("plain.txt"), F("nested/beta.md")]);
});

test("empty or malformed input yields no results", async () => {
	assert.deepEqual(await recentFiles([], tmp), []);
	assert.deepEqual(await recentFiles([null, 42, { type: "message" }, { type: "message", message: { role: "user" } }], tmp), []);
});

test("large messages prefer their newest mentions and repeats do not consume lookup budget", async () => {
	const long = userMsg(`plain.txt ${" ".repeat(300_000)}nested/beta.md`);
	assert.deepEqual(await recentFiles([long], tmp), [F("nested/beta.md")]);
	const repeated = userMsg(`nested/alpha.txt ${"plain.txt ".repeat(1500)}`);
	assert.deepEqual(await recentFiles([repeated], tmp), [F("plain.txt"), F("nested/alpha.txt")]);
});

test("structured paths prefer literal names and exact preview records never fall back", { skip: process.platform === "win32" }, async () => {
	for (const name of ["report:42", "report", "note!", "note", "missing"]) writeFileSync(F(name), "");
	assert.deepEqual(await recentFiles([asstMsg([call({ path: "report:42" }), call({ path: "note!" })])], tmp),
		[F("note!"), F("report:42")]);
	assert.deepEqual(await recentFiles([viewOpen(F("report:42")), viewOpen(F("note!")), viewOpen(F("missing:42"))], tmp),
		[F("note!"), F("report:42")]);
	assert.deepEqual(await recentFiles([asstMsg([call({ path: "plain.txt:42:7" })])], tmp), [F("plain.txt")]);
	mkdirSync(F("folder!")); writeFileSync(F("folder"), "");
	symlinkSync(F("absent-target"), F("broken!")); writeFileSync(F("broken"), "");
	assert.deepEqual(await recentFiles([asstMsg([call({ path: "folder!" }), call({ path: "broken!" })])], tmp), []);
});

test("malformed brackets and selector-like tails cannot monopolize recent scanning", () => {
	const code = `
		import { recentFiles } from ${JSON.stringify(new URL("../src/recents.ts", import.meta.url).href)};
		const text = "[".repeat(100000) + " " + ".".repeat(100000) + "x " + ":1".repeat(20000) + "x plain.txt";
		console.log(JSON.stringify(await recentFiles([{ type: "message", message: { content: text } }], ${JSON.stringify(tmp)})));
	`;
	const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", timeout: 10_000 });
	assert.deepEqual(JSON.parse(result), [F("plain.txt")]);
});
