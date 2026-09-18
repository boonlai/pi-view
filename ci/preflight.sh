#!/usr/bin/env bash
# Fails the job when a test prerequisite is missing or pinned to the wrong
# version. The suite silently skips OMP/Poppler-backed tests when the binaries
# are absent; this gate guarantees CI never loses that coverage unnoticed.
set -euo pipefail

fail() {
	echo "::error::$1"
	exit 1
}

node_version="$(node --version)" || fail "node is not on PATH"
[ "$node_version" = "v22.22.0" ] || fail "node is $node_version, expected v22.22.0"

command -v nvim >/dev/null 2>&1 || fail "nvim is not on PATH (ci/setup-tools.sh should have installed it)"
nvim_version="$(nvim --version | head -1)"
case "$nvim_version" in
	"NVIM v0.12.5"*) ;;
	*) fail "nvim is '$nvim_version', expected NVIM v0.12.5" ;;
esac

# Presence first (a missing tool's "command not found" diagnostic must never
# pass the gate), then a status-checked probe with a strict "<tool> version " prefix.
poppler_versions=""
for poppler_tool in pdftoppm pdfinfo pdftotext; do
	command -v "$poppler_tool" >/dev/null 2>&1 || fail "$poppler_tool is not on PATH (Poppler missing or broken)"
	if ! poppler_line="$("$poppler_tool" -v 2>&1 | head -1)"; then
		fail "$poppler_tool -v exited nonzero"
	fi
	case "$poppler_line" in
		"$poppler_tool version "*) ;;
		*) fail "$poppler_tool version output unexpected: '$poppler_line'" ;;
	esac
	poppler_versions="$poppler_versions$poppler_line | "
done

[ -n "${PI_VIEW_OMP:-}" ] || fail "PI_VIEW_OMP is not set (ci/setup-tools.sh should have exported it)"
omp_version="$("$PI_VIEW_OMP" --version 2>&1)" || fail "PI_VIEW_OMP=$PI_VIEW_OMP is not executable"
case "$omp_version" in
	*18.2.4*) ;;
	*) fail "omp --version reported '$omp_version', expected 18.2.4" ;;
esac

echo "node $node_version"
echo "$nvim_version"
echo "${poppler_versions%" | "}"
echo "omp $(printf '%s' "$omp_version" | head -1)"
