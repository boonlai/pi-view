# Releasing pi-view

The first npm version is `pi-view@0.3.0`; do not reset the version or move its existing tag. Git-installed Pi and OMP instructions remain in the README until an npm release is available and the hosts' npm install path is verified.

## Publish the first npm version

The existing `v0.3.0` tag contains the earlier token-based release workflow. Changing `release.yml` on `main` cannot change the workflow at that tag. Do not rerun its publish job after npm accepts `0.3.0`, and do not create or move the tag.

The npm package owner must publish the original, verified `0.3.0` release archive once from a local terminal. Download the `release-package` artifact from the original tag run into `release-assets/` if it is not already there. Use its `pi-view-0.3.0.tgz` and matching `.sha256` file, not a locally rebuilt archive or a placeholder package. Confirm that `pi-view@0.3.0` does not already exist on npm, then sign in and complete the account's 2FA challenge when publishing:

```bash
(cd release-assets && shasum -a 256 --check pi-view-0.3.0.tgz.sha256)
npm login
npm publish release-assets/pi-view-0.3.0.tgz --access public
```

Stop if the checksum fails or the version already exists. A local owner-authenticated publish does not have GitHub Actions provenance. Once npm has accepted the version, use the original tag and the same archive and checksum to create or repair the GitHub release as described under recovery below. Future versions use the OIDC tag workflow after the trusted publisher is configured.

## Prepare a release

1. For a later release, make the version change in a pull request with `npm version patch --no-git-tag-version`, `npm version minor --no-git-tag-version`, or `npm version major --no-git-tag-version`. This updates both `package.json` and the lockfile root. Patch releases fix defects; minor releases add features. Before 1.0, breaking changes need a minor bump; explicitly call them out in the GitHub release notes after the generated notes are created.
2. Commit source and tests as needed. If source changes, run `npm run build` and commit the updated `dist/` files. CI checks that its build reproduces the committed bundles. Review the public package metadata and the files that will be packed; the release workflow permits only `package.json`, `README.md`, `LICENSE`, `dist/index.js`, and `dist/image-worker.mjs`.
3. Merge the pull request into `main`. Wait for a successful **CI** run triggered by the push to `main` for the exact commit to be tagged. PR checks, runs from another branch, and checks on another commit do not qualify. CI runs its existing Linux, macOS, and Windows jobs; the release workflow does not repeat that matrix.
4. Optionally run **Actions → Release → Run workflow** on `main`. This checks the same commit and version prerequisites, installs dependencies, checks and builds `dist/`, packs the archive, installs it in a clean consumer, tests the distributed image worker, and uploads the archive and SHA-256 checksum for seven days. It does not publish or create a tag or release. A dry run needs a successful qualifying CI push first.
5. On an up-to-date local `main`, create and push the matching stable tag:

   ```bash
   git fetch origin main --tags
   git switch main
   git pull --ff-only origin main
   VERSION=$(node -p "require('./package.json').version")
   git tag -a "v$VERSION" -m "Release v$VERSION"
   git push origin "v$VERSION"
   ```

The `vX.Y.Z` tag for a later release must point to a commit reachable from `origin/main`, match the package and lockfile root versions, and have a successful CI push on `main` for that SHA. The repository must be public, and the package must be non-private. The tag run checks these conditions before packing. With npm trusted publishing configured, a successful new tag run publishes the same tested tarball to npm with GitHub Actions provenance and public access, then creates a GitHub release with generated notes, the tarball, and its checksum. Stable releases use npm's `latest` dist-tag. Versions and release tags are immutable; fix a failed release with a new version rather than moving a tag or republishing a version.

## Trusted publishing and recovery

After the owner publishes `0.3.0`, configure a GitHub Actions trusted publisher for `pi-view` in npm package settings. Set GitHub owner to `boonlai`, repository to `pi-view`, workflow filename to `release.yml`, and environment to `npm`. Explicitly allow this connection to publish: new connections may default to staging only. These values must match the tag workflow exactly before pushing a later release tag. See [npm's trusted publisher instructions](https://docs.npmjs.com/trusted-publishers#github-actions-configuration).

The `npm` GitHub environment is restricted to `v*` tags. The publish job requests `id-token: write`, installs Node `22.22.2` and npm `12.1.0`, then uses npm's OIDC authentication to publish the verified archive. No npm token is needed by the workflow. After configuring the trusted publisher, set the package's publishing access to **Require two-factor authentication and disallow tokens**; this does not block OIDC publishing. The owner still uses account 2FA for the initial manual publish. Removing a GitHub Actions secret does not revoke an npm access token; after trusted publishing succeeds, the owner must revoke any superseded automation token in npm settings. Do not add a bypass-2FA token.

If verification fails because the exact-commit CI push is still running for a later tag, rerun the failed tag workflow after CI succeeds. Never rerun the original `v0.3.0` token-based publish job once `0.3.0` exists on npm. For a version, metadata, or tag mismatch, fix the issue in a new commit and release under a new version and tag; do not move an existing tag. If npm publication fails, inspect the run and whether the version exists on npm before taking any action. Do not republish an existing version.

If npm publication succeeds but GitHub release creation or asset upload fails, do not rerun the publish job. Download the corresponding run's `release-package` artifact while it is retained and verify its checksum. Confirm that `pi-view@${TAG#v}` exists on npm, then create the missing release from its original tag or upload any missing assets to an existing release:

```bash
# Set RUN_ID to the run containing the original tested archive and TAG to its vX.Y.Z tag.
mkdir -p release-assets
gh run download "$RUN_ID" --name release-package --dir release-assets
(cd release-assets && shasum -a 256 --check ./*.tgz.sha256)
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --clobber
else
  gh release create "$TAG" release-assets/*.tgz release-assets/*.tgz.sha256 --verify-tag --generate-notes --title "$TAG"
fi
```

The workflow's artifact expires after seven days, so retain it securely if release creation needs later repair. Do not place npm credentials in the repository or release assets.
