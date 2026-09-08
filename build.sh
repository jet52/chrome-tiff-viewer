#!/usr/bin/env bash
# Build a distributable zip of the extension.
#
# Usage: ./build.sh [git-ref]
#
# Packages the committed tree at <git-ref> (default: HEAD) into
# dist/tiff-viewer-<version>.zip, where <version> comes from manifest.json.
# The zip contains a single top-level folder, tiff-viewer-<version>/, that
# can be selected directly with "Load unpacked" in chrome://extensions.
#
# Files marked `export-ignore` in .gitattributes are left out. Uncommitted
# changes are never included; commit first.
set -euo pipefail

cd "$(dirname "$0")"
ref="${1:-HEAD}"

version=$(git show "$ref:manifest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
name="tiff-viewer-$version"
out="dist/$name.zip"

if [ "$ref" = "HEAD" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "warning: working tree has uncommitted changes; they will not be included" >&2
fi

mkdir -p dist
rm -f "$out"
git archive --format=zip --prefix="$name/" -o "$out" "$ref"

echo "built $out"
unzip -l "$out" | tail -1
