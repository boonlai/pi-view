import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const repo = process.env.GITHUB_REPOSITORY;
const event = process.env.GITHUB_EVENT_NAME;
const ref = process.env.GITHUB_REF;
const sha = process.env.GITHUB_SHA;

assert.equal(repo, "boonlai/pi-view", "releases are restricted to the upstream repository");
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "package version must be stable SemVer");
assert.equal(pkg.name, "pi-view");
assert.equal(pkg.private, false, "the package must be explicitly public");
assert.equal(pkg.publishConfig?.access, "public");
assert.equal(pkg.repository?.url, `git+https://github.com/${repo}.git`);
assert.equal(pkg.homepage, `https://github.com/${repo}#readme`);
assert.equal(pkg.bugs?.url, `https://github.com/${repo}/issues`);
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages?.[""]?.name, pkg.name);
assert.equal(lock.packages?.[""]?.version, pkg.version);

if (event === "push") {
  const tag = `v${pkg.version}`;
  assert.equal(ref, `refs/tags/${tag}`, "tag must match the package version");
  assert.equal(execFileSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" }).trim(), sha, "tag must point to the checked-out commit");
} else {
  assert.equal(event, "workflow_dispatch", "only tag pushes and manual dry runs are supported");
  assert.equal(ref, "refs/heads/main", "manual dry runs must use main");
}

const checkedOut = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(checkedOut, sha, "checked-out commit differs from the triggering commit");
try {
  execFileSync("git", ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/main"], { stdio: "pipe" });
} catch {
  throw new Error("release commit is not reachable from origin/main");
}

const token = process.env.GITHUB_TOKEN;
assert.ok(token, "GitHub token is required to verify the public repository and CI");
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
async function github(path) {
  const response = await fetch(`${base}/repos/${repo}${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API rejected ${path.split("?")[0]} (HTTP ${response.status})`);
  return response.json();
}

const repository = await github("");
assert.equal(repository.private, false, "repository must be public");
assert.equal(repository.visibility, "public", "repository must be publicly visible");

const query = new URLSearchParams({ head_sha: sha, event: "push", branch: "main", status: "success", per_page: "100" });
const runs = await github(`/actions/workflows/ci.yml/runs?${query}`);
assert.ok(runs.workflow_runs?.some(run =>
  run.head_sha === sha && run.event === "push" && run.head_branch === "main" &&
  run.status === "completed" && run.conclusion === "success"
), "CI push on main must have succeeded for this exact commit");
console.log(`Release prerequisites passed for ${pkg.name}@${pkg.version} (${sha}).`);
