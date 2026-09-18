#!/usr/bin/env bash
# CI tool setup for the pi-view test suite (ubuntu-latest, macos-latest, windows-latest).
#
# Installs, into $RUNNER_TEMP (never into the worktree):
#   - Neovim v0.12.5 from the official neovim/neovim release archive (no published
#     checksums exist, so the exact release tag is the pin)
#   - Oh My Pi (OMP) v18.2.4 from the official can1357/oh-my-pi release, verified
#     against the release's published SHA256SUMS.txt
#   - Poppler (pdfinfo/pdftoppm/pdftotext) via the OS package manager, only when missing
#
# The suite silently skips OMP/Poppler/editor-backed tests when these binaries are
# absent, so every step here either succeeds or fails the job; nothing is optional.
# ci/preflight.sh independently re-asserts the versions afterwards.
#
# No secrets are required: release assets are public download URLs.
set -euo pipefail

: "${GITHUB_PATH:?GITHUB_PATH must be set (run inside GitHub Actions)}"
: "${GITHUB_ENV:?GITHUB_ENV must be set (run inside GitHub Actions)}"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set (run inside GitHub Actions)}"

readonly NVIM_VERSION=0.12.5
readonly OMP_REPO=can1357/oh-my-pi
readonly OMP_VERSION=v18.2.4

TOOLS_DIR="$RUNNER_TEMP/pi-view-ci-tools"
mkdir -p "$TOOLS_DIR"

case "$(uname -s)" in
	Linux) os=linux ;;
	Darwin) os=darwin ;;
	MINGW* | MSYS* | CYGWIN*) os=windows ;;
	*)
		echo "::error::unsupported runner OS: $(uname -s)"
		exit 1
		;;
esac
case "$(uname -m)" in
	x86_64 | amd64) machine=x86_64 ;;
	arm64 | aarch64) machine=arm64 ;;
	*)
		echo "::error::unsupported runner architecture: $(uname -m)"
		exit 1
		;;
esac

# GITHUB_PATH / GITHUB_ENV values must work for later bash steps and for node's
# child_process. On Windows that means Windows-style paths (D:/...); cygpath -m
# (bundled with Git Bash) produces that form.
if [ "$os" = windows ]; then
	host_path() { cygpath -m "$1"; }
else
	host_path() { printf '%s' "$1"; }
fi

fetch() { # fetch <url> <outfile>
	curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"
}

# --- Neovim (editor integration tests) --------------------------------------
case "$os" in
	linux) nvim_asset="nvim-linux-${machine}.tar.gz" ;;
	darwin) nvim_asset="nvim-macos-${machine}.tar.gz" ;;
	windows)
		if [ "$machine" = arm64 ]; then nvim_asset="nvim-win-arm64.zip"; else nvim_asset="nvim-win64.zip"; fi
		;;
esac
nvim_dir="$TOOLS_DIR/neovim"
mkdir -p "$nvim_dir"
echo "Downloading Neovim v${NVIM_VERSION} (${nvim_asset})..."
fetch "https://github.com/neovim/neovim/releases/download/v${NVIM_VERSION}/${nvim_asset}" "$nvim_dir/$nvim_asset"
case "$nvim_asset" in
	*.zip) /c/Windows/System32/tar.exe -xf "$nvim_dir/$nvim_asset" -C "$nvim_dir" ;; # bsdtar reads zip
	*) tar -xzf "$nvim_dir/$nvim_asset" -C "$nvim_dir" ;;
esac
rm -f "$nvim_dir/$nvim_asset"
nvim_bin_dir="$nvim_dir/${nvim_asset%.zip}"
nvim_bin_dir="${nvim_bin_dir%.tar.gz}"
echo "$(host_path "$nvim_bin_dir/bin")" >> "$GITHUB_PATH"

# --- Oh My Pi (extension host integration tests) -----------------------------
case "$machine" in
	x86_64) omp_arch=x64 ;;
	arm64) omp_arch=arm64 ;;
esac
case "$os" in
	linux) omp_asset="omp-linux-${omp_arch}" ;;
	darwin) omp_asset="omp-darwin-${omp_arch}" ;;
	windows) omp_asset="omp-windows-${omp_arch}.exe" ;;
esac
omp_dir="$TOOLS_DIR/omp"
mkdir -p "$omp_dir"
echo "Downloading OMP ${OMP_VERSION} (${omp_asset})..."
fetch "https://github.com/${OMP_REPO}/releases/download/${OMP_VERSION}/${omp_asset}" "$omp_dir/$omp_asset"
fetch "https://github.com/${OMP_REPO}/releases/download/${OMP_VERSION}/SHA256SUMS.txt" "$omp_dir/SHA256SUMS.txt"
(
	cd "$omp_dir"
	checksum_line="$(grep -E " ${omp_asset}\$" SHA256SUMS.txt || true)"
	if [ -z "$checksum_line" ]; then
		echo "::error::${omp_asset} is not listed in the published SHA256SUMS.txt"
		exit 1
	fi
	if command -v sha256sum >/dev/null 2>&1; then
		printf '%s\n' "$checksum_line" | sha256sum -c - >/dev/null
	else
		printf '%s\n' "$checksum_line" | shasum -a 256 -c - >/dev/null
	fi
)
if [ "$os" = windows ]; then
	mv "$omp_dir/$omp_asset" "$omp_dir/omp.exe" # the release asset is a real exe, not a shell wrapper
	omp_bin="$omp_dir/omp.exe"
else
	chmod +x "$omp_dir/$omp_asset"
	omp_bin="$omp_dir/$omp_asset"
fi
echo "$(host_path "$omp_dir")" >> "$GITHUB_PATH"
omp_env="$(host_path "$omp_bin")"
echo "PI_VIEW_OMP=$omp_env" >> "$GITHUB_ENV"

# --- Poppler (PDF-backed tests) ----------------------------------------------
# The Windows runner image ships an inherited Xpdf toolchain (xpdfreader.com)
# whose same-named pdftoppm/pdftotext/pdfinfo are NOT Poppler, so existing
# binaries are not trusted there: real Poppler is always installed and its
# directory is written last to GITHUB_PATH, which the runner puts first on
# PATH, so all three tools resolve to the same Poppler install. On Linux the
# image ships real poppler-utils (kept when present); macOS installs via brew.
case "$os" in
	linux)
		if command -v pdftoppm >/dev/null 2>&1; then
			echo "Poppler already present on PATH: $(command -v pdftoppm)"
		else
			echo "Installing Poppler via apt..."
			sudo apt-get update -qq
			sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends poppler-utils
		fi
		;;
	darwin)
		if command -v pdftoppm >/dev/null 2>&1; then
			echo "Poppler already present on PATH: $(command -v pdftoppm)"
		else
			echo "Installing Poppler via Homebrew..."
			brew install poppler
		fi
		;;
	windows)
		echo "Installing Poppler via Chocolatey (image may carry same-named Xpdf tools, which are not Poppler)..."
		choco install poppler -y --no-progress
		shopt -s nullglob
		poppler_bins=(/c/ProgramData/chocolatey/lib/poppler/tools/poppler-*/Library/bin)
		shopt -u nullglob
		if [ "${#poppler_bins[@]}" -eq 0 ]; then
			echo "::error::chocolatey installed poppler, but no */Library/bin directory was found"
			exit 1
		fi
		poppler_bin="${poppler_bins[${#poppler_bins[@]}-1]}"
		# Written after the nvim/omp entries, and the runner prepends GITHUB_PATH
		# entries, so this directory ends up ahead of any inherited Xpdf tools.
		echo "$(host_path "$poppler_bin")" >> "$GITHUB_PATH" # chocolatey does not add this to PATH itself
		;;
esac

echo "Tool setup complete:"
echo "  nvim: $(host_path "$nvim_bin_dir/bin") (on PATH)"
echo "  omp:  $omp_env (on PATH and in PI_VIEW_OMP)"
