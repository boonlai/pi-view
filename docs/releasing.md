# Releasing pi-view

The first npm release is `pi-view@0.3.0`; do not reset the version. Git-installed Pi and OMP instructions remain in the README until an npm release is available and the hosts' npm install path is verified.

## Prepare a release

1. For a later release, make the version change in a pull request with `npm version patch --no-git-tag-version`, `npm version minor --no-git-tag-version`, or `npm version major --no-git-tag-version`. This updates both `package.json` and the lockfile root. Patch releases fix defects; minor releases add features. Before 1.0, breaking changes need a minor bump; explicitly call them out in the GitHub release notes after the generated notes are created. The initial `0.3.0` release does not need a bump.
2. Commit source and tests as needed. If source changes, run `npm run build` and commit the updated `dist/` files. CI checks that its build reproduces the committed bundles. Review the public package metadata and the files that will be packed; the release workflow permits only `package.json`, `README.md`, `LICENSE`, `dist/index.js`, and `dist/image-worker.mjs`.
3. Merge the pull request into `main`. Wait for a successful **CI** run triggered by the push to `main` for the exact commit to be tagged. PR checks, runs from another branch, and checks on another commit do not qualify. CI runs its existing Linux, macOS, and Windows jobs; the release workflow does not repeat that matrix.
4. Optionally run **Actions → Release → Run workflow** on `main`. This checks the same commit and version prerequisites, installs dependencies, checks and builds `dist/`, packs the archive, installs it in a clean consumer, tests the distributed image worker, and uploads the archive and SHA-256 checksum for seven days. It does not publish, create a tag or release, or use the npm token. A dry run needs a successful qualifying CI push first.
5. On an up-to-date local `main`, create and push the matching stable tag:

   ```bash
   git fetch origin main --tags
   git switch main
   git pull --ff-only origin main
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin "v$VERSION"
   ```

The `vX.Y.Z` tag must point to a commit reachable from `origin/main`, match the package and lockfile root versions, and have a successful CI push on `main` for that SHA. The repository must be public, and the package must be non-private. The tag run checks these conditions before packing. A successful tag run publishes the same tested tarball to npm with provenance and public access, then creates a GitHub release with generated notes, the tarball, and its checksum. Stable releases use npm's `latest` dist-tag. Versions and release tags are immutable; fix a failed release with a new version rather than moving a tag or republishing a version.

## Credentials and recovery

The `npm` GitHub environment is restricted to `v*` tags. Its `NPM_TOKEN` secret must be an npm granular token with publish rights for `pi-view` and a 2FA bypass suitable for CI publication. Only the publish step receives this token; the verify job and manual runs do not. Rotate or revoke the token through npm and update the environment secret when needed. npm provenance uses the publish job's GitHub OIDC permission. Trusted publishing can be considered after the first npm package exists; it is not configured here.

If verification fails because the exact-commit CI push is still running, rerun the failed tag workflow after CI succeeds. For a version, metadata, or tag mismatch, fix the issue in a new commit and release under a new version and tag; do not move an existing tag. If npm publication fails, inspect the run and whether the version exists on npm before taking any action. Do not republish an existing version.

If npm publication succeeds but GitHub release creation or asset upload fails, do not rerun the publish job. Download that run's `release-package` artifact while it is retained and verify its checksum. Confirm that `pi-view@${TAG#v}` exists on npm, then create the missing release from its original tag or upload any missing assets to an existing release:

```bash
# Set RUN_ID to the successful publish run and TAG to its vX.Y.Z tag.
mkdir -p release-assets
gh run download "$RUN_ID" --name release-package --dir release-assets
(cd release-assets && sha256sum --check ./*.tgz.sha256)
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --clobber
else
  gh release create "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --verify-tag --generate-notes --title "$TAG"
fi
```

The workflow's artifact expires after seven days, so retain it securely if release creation needs later repair. Do not place npm credentials in the repository or release assets.
