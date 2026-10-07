#!/bin/sh
set -eu

cache_root="$HOME/.cursor/plugins/cache/cursor-public/pstack"
stable_link="$HOME/.cursor/plugins/pstack-current"

latest=""
for candidate in "$cache_root"/*; do
    [ -f "$candidate/skills/poteto-mode/SKILL.md" ] || continue
    if [ -z "$latest" ] || [ "$candidate" -nt "$latest" ]; then
        latest="$candidate"
    fi
done

if [ -z "$latest" ]; then
    echo "No complete pstack installation found under $cache_root" >&2
    exit 1
fi

mkdir -p "$(dirname "$stable_link")"
ln -sfn "$latest" "$stable_link"
printf '%s\n' "$latest"
