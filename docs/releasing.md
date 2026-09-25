# Releasing pi-view

The first npm version is `@boonlai/pi-view@0.3.1`. The existing `v0.3.0` tag is historical and refers to the unscoped name. Do not move that tag or run its publish job. Git-installed Pi and OMP instructions remain in the README until the npm release is available and the hosts' npm install paths have been verified.

## Publish the first npm version

Before `npm login` or `npm publish`, the package owner must enable account two-factor authentication for authentication and writes in npm settings. The owner must complete their own browser sign-in and 2FA challenge. Do not use an npm automation token or a bypass-2FA token.

From the committed `0.3.1` release candidate, run the same checks and clean-consumer archive test as the release workflow. These commands work from anywhere inside the checkout and keep the tested archive outside it:

```bash
ROOT="$(git rev-parse --show-toplevel)"
RELEASE_TEMP="$(mktemp -d)"
(
  set -e
  cd "$ROOT"
  npm ci
  npm run check
  npm run build
  node ci/check-dist.mjs
  RUNNER_TEMP="$RELEASE_TEMP" node ci/pack-release.mjs
)
(cd "$RELEASE_TEMP/pi-view-release" && shasum -a 256 --check boonlai-pi-view-0.3.1.tgz.sha256)
(cd "$ROOT" && npm view @boonlai/pi-view@0.3.1 version --registry=https://registry.npmjs.org)
```

The checksum must pass. The npm lookup must confirm that `@boonlai/pi-view@0.3.1` is absent; stop if the version exists or the lookup fails for another reason. Once absence is confirmed, sign in and publish the tested archive:

```bash
(cd "$ROOT" && npm login --auth-type=web)
(cd "$ROOT" && npm publish "$RELEASE_TEMP/pi-view-release/boonlai-pi-view-0.3.1.tgz" --registry=https://registry.npmjs.org --access public)
```

Keep the archive and checksum until the matching tag run succeeds. An owner-authenticated local publish does not carry GitHub Actions provenance. Wait until npm exposes `@boonlai/pi-view@0.3.1` in its version lookup; then, after the exact-commit CI push on `main` succeeds, create and push `v0.3.1` using the steps below. The tag workflow checks the published version's SHA-512 integrity against its tested archive. An exact match skips npm publishing and creates the GitHub release; a mismatch or registry error stops the workflow. Configure trusted publishing as described below for later releases.

## Prepare a release

1. For the first npm release, keep the committed `0.3.1` version. For a later release, make the version change in a pull request with `npm version patch --no-git-tag-version`, `npm version minor --no-git-tag-version`, or `npm version major --no-git-tag-version`. This updates both `package.json` and the lockfile root. Patch releases fix defects; minor releases add features. Before 1.0, breaking changes need a minor bump; explicitly call them out in the GitHub release notes after the generated notes are created.
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

After the owner publishes `0.3.1`, configure a GitHub Actions trusted publisher for `@boonlai/pi-view` in npm package settings. Set GitHub owner to `boonlai`, repository to `pi-view`, workflow filename to `release.yml`, and environment to `npm`. Explicitly allow this connection to publish: new connections may default to staging only. These values must match the tag workflow exactly before pushing a later release tag. See [npm's trusted publisher instructions](https://docs.npmjs.com/trusted-publishers#github-actions-configuration).

The `npm` GitHub environment is restricted to `v*` tags. The publish job requests `id-token: write`, installs Node `22.22.2` and npm `12.1.0`, then uses npm's OIDC authentication to publish the verified archive. npm generates provenance automatically for the OIDC publish. No npm token is needed by the workflow. After configuring the trusted publisher, set the package's publishing access to **Require two-factor authentication and disallow tokens**; this does not block OIDC publishing. Removing a GitHub Actions secret does not revoke an npm access token; after trusted publishing succeeds, the owner must revoke any superseded automation token in npm settings.

If verification fails because the exact-commit CI push is still running, rerun the failed tag workflow after CI succeeds. Never rerun the historical `v0.3.0` publish job. For a version, metadata, or tag mismatch, fix the issue in a new commit and release under a new version and tag; do not move an existing tag. If npm publication fails, inspect the run and whether the version exists on npm before taking any action. A rerun checks integrity and skips a matching version; it never republishes an existing version.

If npm publication succeeds but GitHub release creation or asset upload fails, rerun the tag workflow after confirming the existing version matches the tested archive. The registry integrity check skips npm publishing and the job can create the missing release. Alternatively, download the run's `release-package` artifact while it is retained and verify its checksum and SHA-512 integrity against npm metadata. Then create the missing release from its original tag or upload any missing assets to an existing release:

```bash
# Set RUN_ID to the run containing the original tested archive and TAG to its vX.Y.Z tag.
ROOT="$(git rev-parse --show-toplevel)"
(
  set -e
  cd "$ROOT"
  mkdir -p release-assets
  gh run download "$RUN_ID" --name release-package --dir release-assets
  (cd release-assets && shasum -a 256 --check ./*.tgz.sha256)
  expected="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); console.log(`sha512-${createHash("sha512").update(readFileSync(process.argv[1])).digest("base64")}`)' release-assets/*.tgz)"
  published="$(npm view "@boonlai/pi-view@${TAG#v}" dist.integrity --registry=https://registry.npmjs.org)"
  test "$published" = "$expected"
  if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --clobber
  else
    gh release create "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --verify-tag --generate-notes --title "$TAG"
  fi
)
```

The workflow's artifact expires after seven days, so retain it securely if release creation needs later repair. Do not place npm credentials in the repository or release assets.
