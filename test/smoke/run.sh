#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SMOKE_DIR="$REPO_ROOT/test/smoke"

cd "$REPO_ROOT"

echo "==> clean"
rm -f "$SMOKE_DIR"/prisma-guard-*.tgz
rm -rf "$SMOKE_DIR/node_modules"
rm -rf "$SMOKE_DIR/generated"

echo "==> build"
npm run build

echo "==> pack"
npm pack --pack-destination "$SMOKE_DIR"

cd "$SMOKE_DIR"

echo "==> install deps"
npm install

echo "==> install tarball"
npm install ./prisma-guard-*.tgz

echo "==> prisma generate"
npx prisma generate --schema schema.prisma

echo "==> typecheck"
npx tsc --noEmit

echo "==> run smoke test"
npx tsx smoke.ts

echo "==> smoke test passed"