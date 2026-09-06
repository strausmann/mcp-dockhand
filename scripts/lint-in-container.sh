#!/usr/bin/env bash
set -euo pipefail

# Runs ESLint in a throwaway node:22 container instead of via the committed
# devDependencies. Why: this repo pins the TypeScript 7 preview compiler
# (package.json), and typescript-eslint@8 hard-throws at import time on
# TypeScript >=7 (no config escape hatch; upstream tracking:
# typescript-eslint#10940). The rules this repo's eslint.config.js runs
# (no-unused-vars, no-explicit-any) are not type-aware -- they don't need the
# TS7 compiler at all, so pointing ESLint at a TypeScript 5 install inside the
# container gets a working lint without touching what the repo actually
# builds/ships with. Only src/, tests/ and eslint.config.js are mounted
# (read-only) -- no docker.sock, no secrets, nothing written back to the host.
#
# This is a minimal stand-in, not the final shape: proper image/digest
# pinning for container-based checks is expected to arrive with the planned
# container-testing plugin. Until then, the npm package versions below are
# pinned explicitly so a `latest`-tag drift can't silently change what "lint
# passes" means from one run to the next.

docker run --rm \
  -v "$PWD/src":/lint/src:ro \
  -v "$PWD/tests":/lint/tests:ro \
  -v "$PWD/eslint.config.js":/lint/eslint.config.js:ro \
  -w /lint node:22 sh -c '
    printf "{\"type\":\"module\",\"private\":true}" > package.json
    npm i --no-audit --no-fund eslint@10.8.1 typescript-eslint@8.67.0 typescript@5.9.3 >/dev/null 2>&1
    npx eslint .
  '
