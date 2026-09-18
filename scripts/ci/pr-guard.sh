#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "== pr-guard =="

run_node_project() {
  local dir="$1"
  local pkg="$dir/package.json"

  if [ ! -f "$pkg" ]; then
    return 1
  fi

  local has_lint has_test
  has_lint="$(node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(pkg.scripts && pkg.scripts.lint ? '1' : '0');" "$pkg")"
  has_test="$(node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(pkg.scripts && pkg.scripts.test ? '1' : '0');" "$pkg")"

  if [ "$has_lint$has_test" = "00" ]; then
    return 1
  fi

  pushd "$dir" >/dev/null

  local package_manager="npm"
  if [ -f pnpm-lock.yaml ]; then
    package_manager="pnpm"
    corepack enable
    pnpm install --frozen-lockfile
  elif [ -f yarn.lock ]; then
    package_manager="yarn"
    corepack enable
    yarn install --immutable
  elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
    npm ci
  else
    npm install
  fi

  if [ "$has_lint" = "1" ]; then
    echo "Running lint in $dir via $package_manager"
    case "$package_manager" in
      pnpm) pnpm run lint ;;
      yarn) yarn lint ;;
      *) npm run lint ;;
    esac
  fi

  if [ "$has_test" = "1" ]; then
    echo "Running test in $dir via $package_manager"
    case "$package_manager" in
      pnpm) pnpm test ;;
      yarn) yarn test ;;
      *) npm test ;;
    esac
  fi

  popd >/dev/null
  return 0
}

did_run_top_level_checks=0

if run_node_project "."; then
  did_run_top_level_checks=1
elif run_node_project "frontend"; then
  did_run_top_level_checks=1
fi

if [ "$did_run_top_level_checks" -eq 0 ]; then
  echo "No top-level package manager workflow found; running repository smoke checks."
  test -f README.md
  test -f frontend/index.html
  test -f frontend/app.js
  test -f backend/main.py
  python3 -m py_compile run.py backend/main.py
  python3 -m compileall -q backend services
fi

echo "pr-guard passed"
