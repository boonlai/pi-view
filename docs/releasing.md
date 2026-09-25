# Releasing pi-view

The npm package is `@boonlai/pi-view`. Version `0.3.1` was published with owner authentication and has no GitHub Actions provenance; subsequent releases use trusted publishing. The historical `v0.3.0` tag refers to the unscoped name. Do not move it or run its publish job. See the README for installation instructions.

## Prepare a release

1. Make the version change in a pull request with `npm version patch --no-git-tag-version`, `npm version minor --no-git-tag-version`, or `npm version major --no-git-tag-version`. This updates both `package.json` and the lockfile root. Patch releases fix defects; minor releases add features. Before 1.0, breaking changes need a minor bump; explicitly call them out in the GitHub release notes after the generated notes are created.
2. Commit source and tests as needed. If source changes, run `npm run build` and commit the updated `dist/` files. CI checks that its build reproduces the committed bundles. Review the public package metadata and the files that will be packed; the release workflow permits only `package.json`, `README.md`, `LICENSE`, `dist/index.js`, and `dist/image-worker.mjs`.
3. Merge the pull request into `main`. Wait for a successful **CI** run triggered by the push to `main` for the exact commit to be tagged. PR checks, runs from another branch, and checks on another commit do not qualify. CI runs its existing Linux, macOS, and Windows jobs; the release workflow does not repeat that matrix.
4. Optionally run **Actions → Release → Run workflow** on `main`. This checks the same commit and version prerequisites, installs dependencies, checks and builds `dist/`, packs the archive, installs it in a clean consumer, tests the distributed image worker, and uploads the archive and SHA-256 checksum for seven days. It does not publish or create a tag or release. A dry run needs a successful qualifying CI push first.
5. On an up-to-date local `main`, create and push the matching stable tag:

   ```bash
   ROOT="$(git rev-parse --show-toplevel)"
   (
     set -e
     cd "$ROOT"
     git fetch origin main --tags
     git switch main
     git pull --ff-only origin main
     VERSION="$(node -p "require('./package.json').version")"
     git tag -a "v$VERSION" -m "Release v$VERSION"
     git push origin "v$VERSION"
   )
   ```

The `vX.Y.Z` tag must point to a commit reachable from `origin/main`, match the package and lockfile root versions, and have a successful CI push on `main` for that SHA. The repository must be public, and the package must be non-private. The tag run checks these conditions before packing. It queries npm for the version before publishing: a missing version is published via OIDC, an existing version is accepted only if its SHA-512 integrity matches the tested archive, and other responses or mismatches stop the job. The job then creates a GitHub release with generated notes, the tarball, and its checksum. npm generates provenance when the tag job publishes via OIDC; the first locally published version has no GitHub Actions provenance. Stable releases use npm's `latest` dist-tag. Versions and release tags are immutable; fix a failed release with a new version rather than moving a tag or republishing a version.

## Trusted publishing and recovery

For later releases, check that the GitHub Actions trusted publisher for `@boonlai/pi-view` in npm package settings names owner `boonlai`, repository `pi-view`, workflow `release.yml`, and environment `npm`. The connection must permit direct publishing rather than staging only. These values must match the tag workflow before pushing a release tag. See [npm's trusted publisher instructions](https://docs.npmjs.com/trusted-publishers#github-actions-configuration).

The `npm` GitHub environment is restricted to `v*` tags. The publish job requests `id-token: write` and runs Node `22.22.2`. It installs npm `12.1.0` into an isolated temporary directory, checks that binary's version, and puts it on the path for subsequent steps without replacing the runner's npm installation. npm uses OIDC authentication to publish the verified archive and generates provenance automatically. No npm token is needed by the workflow. After configuring the trusted publisher, set the package's publishing access to **Require two-factor authentication and disallow tokens**; this does not block OIDC publishing. Removing a GitHub Actions secret does not revoke an npm access token; after trusted publishing succeeds, the owner must revoke any superseded automation token in npm settings.

If verification fails because the exact-commit CI push is still running, rerun the failed tag workflow after CI succeeds. Never rerun the historical `v0.3.0` publish job. For a version, metadata, or tag mismatch, fix the issue in a new commit and release under a new version and tag; do not move an existing tag. If npm publication fails, inspect the run and whether the version exists on npm before taking any action. A rerun checks integrity and skips a matching version; it never republishes an existing version.

If npm publication succeeds but GitHub release creation or asset upload fails, rerun the tag workflow after confirming the existing version matches the tested archive. The registry integrity check skips npm publishing and the job can create the missing release. Alternatively, download the run's `release-package` artifact while it is retained and verify its checksum and SHA-512 integrity against npm metadata. Then create the missing release from its original tag or upload any missing assets to an existing release:

```bash
# Set RUN_ID to the run containing the original tested archive and TAG to its vX.Y.Z tag.
ROOT="$(git rev-parse --show-toplevel)"
(
  set -e
  cd "$ROOT"
  ASSETS="release-assets/$TAG"
  mkdir -p "$ASSETS"
  gh run download "$RUN_ID" --name release-package --dir "$ASSETS"
  (cd "$ASSETS" && shasum -a 256 --check ./*.tgz.sha256)
  expected="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); console.log(`sha512-${createHash("sha512").update(readFileSync(process.argv[1])).digest("base64")}`)' "$ASSETS/boonlai-pi-view-${TAG#v}.tgz")"
  published="$(npm view "@boonlai/pi-view@${TAG#v}" dist.integrity --registry=https://registry.npmjs.org)"
  test "$published" = "$expected"
  if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "$ASSETS/"*.tgz "$ASSETS/"*.tgz.sha256 --clobber
  else
    gh release create "$TAG" "$ASSETS/"*.tgz "$ASSETS/"*.tgz.sha256 --verify-tag --generate-notes --title "$TAG"
  fi
)
```

The workflow's artifact expires after seven days, so retain it securely if release creation needs later repair. Do not place npm credentials in the repository or release assets.
