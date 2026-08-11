#!/usr/bin/env bash
# Checks that all intra-repo markdown links resolve to existing files.
# Exit 1 if any broken link is found.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BROKEN=0

# Collect tracked markdown files only: top-level + docs/. Ignored, machine-local
# instruction files are outside the repository's documentation contract.
mapfile -t FILES < <(
  git ls-files -- ':(top,glob)*.md' ':(top,glob)docs/**/*.md'
)

for file in "${FILES[@]}"; do
  dir=$(dirname "$file")
  # Extract markdown links: [text](path)
  mapfile -t LINKS < <(grep -oP '\[.*?\]\(\K[^)]+' "$file" 2>/dev/null || true)
  for link in "${LINKS[@]}"; do
    # Skip URLs, anchors, mailto
    case "$link" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac
    # Strip anchor from link
    target="${link%%#*}"
    [ -z "$target" ] && continue
    # Resolve relative to the file's directory
    resolved="$dir/$target"
    if [ ! -e "$resolved" ]; then
      echo "BROKEN: $file -> $link (resolved: $resolved)"
      BROKEN=1
    fi
  done
done

if [ "$BROKEN" -ne 0 ]; then
  echo ""
  echo "Found broken documentation links. Fix them before committing."
  exit 1
fi

echo "All documentation links OK."
