// Verifies that a fresh `npm run build` reproduces the committed dist/ bundle
// byte for byte. Catches stale, hand-edited, or non-deterministic bundles.
// Byte comparison against the raw index blob (git show :file) is immune to
// checkout line-ending conversion on any runner OS.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const tracked = git("ls-files", "dist")
	.split("\n")
	.filter(Boolean);
if (tracked.length === 0) {
	console.error("::error::no files are tracked under dist/; the committed bundle is missing");
	process.exit(1);
}

let failed = false;
for (const file of tracked) {
	let committed;
	try {
		committed = execFileSync("git", ["show", `:${file}`]);
	} catch {
		console.error(`::error::${file} is tracked but has no git index entry; commit it first`);
		failed = true;
		continue;
	}
	let rebuilt;
	try {
		rebuilt = readFileSync(file);
	} catch {
		console.error(`::error::${file} is tracked but the build no longer produces it; run 'npm run build' and update dist/`);
		failed = true;
		continue;
	}
	if (!committed.equals(rebuilt)) {
		console.error(`::error::rebuilt ${file} differs from the committed bundle; run 'npm run build' and commit the result`);
		failed = true;
	}
}

for (const line of git("status", "--porcelain", "--", "dist").split("\n").filter(Boolean)) {
	if (!line.startsWith("??")) continue; // tracked modifications were already reported byte-exact above
	console.error(`::error::build emitted ${line.slice(3)}, which is not committed`);
	failed = true;
}

if (failed) process.exit(1);
console.log(`dist/ matches the committed bundle (${tracked.length} file${tracked.length === 1 ? "" : "s"}).`);
