import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { MAX_COMPLETIONS, MAX_LIST_ENTRIES, completePath, listDirectory, resolvePath } from "../src/paths.ts";
import { after, test } from "node:test";
const tmp = mkdtempSync(path.join(tmpdir(), "pi-view-paths-"));
// Windows filenames may not contain double quotes or backslashes, so the
// tricky-name fixtures use per-OS spellings; expectations stay independent
// literals on both sides.
const backName = process.platform === "win32" ? "back-slash.txt" : "back\\slash.txt";
const quotedName = process.platform === "win32" ? "a 'quoted' file.txt" : 'a "quoted" file.txt';
const quotedValue = process.platform === "win32"
	? '"my docs/a \'quoted\' file.txt"'
	: '"my docs/a \\"quoted\\" file.txt"';

mkdirSync(path.join(tmp, "nested"));
writeFileSync(path.join(tmp, "nested/alpha.txt"), "a");
writeFileSync(path.join(tmp, "nested/beta.md"), "b");
mkdirSync(path.join(tmp, "my docs"));
writeFileSync(path.join(tmp, "my docs", quotedName), "q");
mkdirSync(path.join(tmp, "my docs/deep"));
writeFileSync(path.join(tmp, backName), "b");
writeFileSync(path.join(tmp, "naïve — café.txt"), "u");
writeFileSync(path.join(tmp, "ünïcode.md"), "u2");
writeFileSync(path.join(tmp, ".env"), "h");
mkdirSync(path.join(tmp, ".hidden-dir"));
writeFileSync(path.join(tmp, "README.md"), "r");
writeFileSync(path.join(tmp, "plain.txt"), "p");
symlinkSync(path.join(tmp, "nested"), path.join(tmp, "link"), process.platform === "win32" ? "junction" : "dir");
symlinkSync(path.join(tmp, "no-such-target"), path.join(tmp, "broken"));
mkdirSync(path.join(tmp, "locked-dir"));
writeFileSync(path.join(tmp, "locked-dir/inner.txt"), "l");
chmodSync(path.join(tmp, "locked-dir"), 0o000);
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

after(() => {
	chmodSync(path.join(tmp, "locked-dir"), 0o700);
	rmSync(tmp, { recursive: true, force: true });
});

test("resolvePath resolves relative, absolute, tilde, and trailing separators", () => {
	assert.equal(resolvePath("nested/alpha.txt", tmp), path.join(tmp, "nested/alpha.txt"));
	assert.equal(resolvePath("nested/../plain.txt", tmp), path.join(tmp, "plain.txt"));
	assert.equal(resolvePath(path.join(tmp, "plain.txt"), tmp), path.join(tmp, "plain.txt"));
	assert.equal(resolvePath("~", tmp), homedir());
	assert.equal(resolvePath("~/", tmp), homedir());
	assert.equal(resolvePath("nested/", tmp), path.join(tmp, "nested"));
});
test("resolvePath parses quotes, escapes, and rejects flags and URLs", () => {
	assert.equal(resolvePath('"my docs/a \\"quoted\\" file.txt"', tmp), path.join(tmp, 'my docs/a "quoted" file.txt'));
	assert.equal(resolvePath("'my docs/deep'", tmp), path.join(tmp, "my docs/deep"));
	assert.equal(resolvePath('"back\\\\slash.txt"', tmp), path.join(tmp, "back\\slash.txt"));
	assert.equal(resolvePath('"~/my docs"', tmp), path.join(homedir(), "my docs"));
	assert.equal(resolvePath('"-dash-name"', tmp), path.join(tmp, "-dash-name")); // quoted dash is a path, not a flag
	assert.throws(() => resolvePath("", tmp), /no path/);
	assert.throws(() => resolvePath("   ", tmp), /no path/);
	assert.throws(() => resolvePath("--json", tmp), /flags/);
	assert.throws(() => resolvePath("-x", tmp), /flags/);
	assert.throws(() => resolvePath("https://example.com/a", tmp), /URL/);
});

test("hidden entries complete only with a dot prefix", () => {
	const plain = completePath("", tmp)!;
	assert.ok(plain.length > 0);
	assert.ok(!plain.some(i => i.value.startsWith(".")));
	assert.ok(plain.some(i => i.value === "README.md"));
	const dotted = completePath(".", tmp)!;
	assert.ok(dotted.some(i => i.value === ".env"));
	assert.ok(dotted.some(i => i.value === ".hidden-dir/"));
	assert.deepEqual(completePath(".env", tmp), [{ value: ".env", label: ".env" }]);
});

test("completions are directories first and every value roundtrips to a real file", () => {
	const order = completePath("", tmp)!.map(i => i.label);
	assert.deepEqual(order, [
		"link/",
		"locked-dir/",
		"my docs/",
		"nested/",
		"README.md",
		backName,
		"broken",
		"naïve — café.txt",
		"plain.txt",
		"ünïcode.md",
	]);
	for (const args of ["", "n", "nested/", "nested/a", "my", '"my docs/', ".", "li", "ü", "README", "b", "back"]) {
		for (const item of completePath(args, tmp) ?? []) {
			const resolved = resolvePath(item.value, tmp);
			let onDisk: boolean;
			try {
				lstatSync(resolved);
				onDisk = true;
			} catch {
				onDisk = false;
			}
			assert.ok(onDisk, `${item.value} must resolve to a real directory entry`);
		}
	}
});

test("directory completions descend on subsequent completion", () => {
	const first = completePath("nested", tmp)!;
	assert.deepEqual(first, [{ value: "nested/", label: "nested/" }]);
	const second = completePath(first[0].value, tmp)!;
	assert.deepEqual(second.map(i => i.value), ["nested/alpha.txt", "nested/beta.md"]);
	const third = completePath("nested/al", tmp)!;
	assert.deepEqual(third, [{ value: "nested/alpha.txt", label: "alpha.txt" }]);
	assert.equal(resolvePath(third[0].value, tmp), path.join(tmp, "nested/alpha.txt"));
});

test("names with spaces and quotes roundtrip through editor replacement", () => {
	const step1 = completePath("my", tmp)!;
	assert.deepEqual(step1.map(i => i.value), ['"my docs/']);
	// the editor replaces everything after "/view " with item.value, so feeding
	// the value back as the argument is exactly what the next Tab does
	const step2 = completePath(step1[0].value, tmp)!;
	assert.deepEqual(step2.map(i => i.value), ['"my docs/deep/', quotedValue]);
	assert.equal(resolvePath(step2[1].value, tmp), path.join(tmp, "my docs", quotedName));
	const again = completePath(step2[1].value, tmp)!;
	assert.deepEqual(again.map(i => i.value), [step2[1].value]); // completing an exact name yields itself
	const unicode = completePath("n", tmp)!;
	assert.deepEqual(unicode.map(i => i.value), ["nested/", '"naïve — café.txt"']);
	assert.equal(resolvePath(unicode[1].value, tmp), path.join(tmp, "naïve — café.txt"));
	const slashed = completePath("back", tmp)!;
	assert.deepEqual(slashed, [{ value: backName, label: backName }]);
});


test("symlinks to directories descend; broken symlinks complete as files", () => {
	assert.deepEqual(completePath("li", tmp), [{ value: "link/", label: "link/" }]);
	const inside = completePath("link/", tmp)!;
	assert.deepEqual(inside.map(i => i.value), ["link/alpha.txt", "link/beta.md"]);
	assert.deepEqual(completePath("br", tmp), [{ value: "broken", label: "broken" }]);
	assert.equal(resolvePath("broken", tmp), path.join(tmp, "broken"));
});

test("tilde completions preserve the ~ prefix", () => {
	// The real user home is arbitrary (and may contain spaced names that are
	// legally quoted), so the test completes against an isolated temp home.
	const home = mkdtempSync(path.join(tmpdir(), "pi-view-paths-home-"));
	writeFileSync(path.join(home, "home-file.txt"), "h");
	mkdirSync(path.join(home, "spaced dir"));
	const previousHome = process.env.HOME;
	const previousUserprofile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home; // Windows: os.homedir() reads USERPROFILE, not HOME
	try {
		const items = completePath("~", tmp)!;
		const plain = items.find(item => item.label === "home-file.txt");
		assert.ok(plain, "plain home entry must complete");
		assert.ok(plain.value.startsWith("~/"), plain.value); // tilde spelling survives unquoted
		assert.equal(resolvePath(plain.value, tmp), path.join(home, "home-file.txt"));
		const spaced = items.find(item => item.label === "spaced dir/");
		assert.ok(spaced, "spaced home entry must complete");
		assert.equal(spaced.value, '"~/spaced dir/'); // spaced entries keep the ~ under optional quoting
		assert.equal(resolvePath(spaced.value, tmp), path.join(home, "spaced dir"));
	} finally {
		if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
		if (previousUserprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserprofile;
		rmSync(home, { recursive: true, force: true });
	}
});

test("absolute arguments complete outside cwd", () => {
	const items = completePath(path.join(tmp, "nes"), "/");
	assert.deepEqual(items, [{ value: path.join(tmp, "nested") + "/", label: "nested/" }]);
});

test("nonexistent and unreadable targets return no completions", () => {
	assert.equal(completePath("no-such-entry", tmp), null);
	assert.equal(completePath("nested/no-such-dir/", tmp), null);
	assert.equal(completePath("plain.txt/", tmp), null); // not a directory
	assert.equal(completePath("--flag", tmp), null);
	assert.equal(completePath("https://example.com/a", tmp), null);
	// POSIX-only: Windows ignores directory read permission bits, so EACCES never happens there.
	if (!isRoot && process.platform !== "win32") assert.equal(completePath("locked-dir/", tmp), null); // EACCES
});

test("listDirectory returns directories first, sorted, with resolved symlinks", async () => {
	const entries = await listDirectory(tmp);
	const dirs = entries.filter(e => e.directory).map(e => e.name);
	const files = entries.filter(e => !e.directory).map(e => e.name);
	assert.deepEqual(dirs, [".hidden-dir", "link", "locked-dir", "my docs", "nested"]);
	assert.deepEqual(files, [".env", "README.md", backName, "broken", "naïve — café.txt", "plain.txt", "ünïcode.md"]);
	assert.deepEqual(entries.map(e => e.path), entries.map(e => path.join(tmp, e.name)));
	assert.ok(entries.find(e => e.name === "link")!.directory);
	assert.ok(!entries.find(e => e.name === "broken")!.directory);
	await assert.rejects(() => listDirectory(path.join(tmp, "no-such-dir")));
});

test("listing and completions are bounded", async () => {
	const big = mkdtempSync(path.join(tmpdir(), "pi-view-bulk-"));
	try {
		for (let i = 0; i < MAX_LIST_ENTRIES + 5; i++) writeFileSync(path.join(big, `f${String(i).padStart(6, "0")}`), "");
		assert.equal((await listDirectory(big)).length, MAX_LIST_ENTRIES);
		assert.equal(completePath("f", big)!.length, MAX_COMPLETIONS);
	} finally {
		rmSync(big, { recursive: true, force: true });
	}
});

test("completion values quote apostrophes, flags and literal tildes without exposing controls", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-view-quoted-"));
	try {
		for (const name of ["it's.txt", "-flag.txt", "~"]) writeFileSync(path.join(dir, name), "");
		// Control characters are illegal in Windows filenames; on POSIX the ESC
		// name exercises the completer's control-name filter.
		if (process.platform !== "win32") writeFileSync(path.join(dir, "bad\x1b[2J.txt"), "");
		const items = completePath("", dir)!;
		assert.equal(items.length, 3);
		for (const name of ["it's.txt", "-flag.txt", "~"]) {
			const item = items.find(item => item.label === name)!;
			assert.equal(resolvePath(item.value, dir), path.join(dir, name));
		}
		assert.ok(items.every(item => !item.label.includes("\x1b")));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
