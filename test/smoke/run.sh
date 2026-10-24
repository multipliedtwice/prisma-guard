#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SMOKE_DIR="$REPO_ROOT/test/smoke"
SMOKE_WORK="$(mktemp -d "${TMPDIR:-/tmp}/prisma-guard-smoke.XXXXXX")"
trap 'rm -rf "$SMOKE_WORK"' EXIT

cd "$REPO_ROOT"

echo "==> build"
npm run build

echo "==> pack"
TARBALL="$(npm pack --pack-destination "$SMOKE_WORK" --silent)"

cp "$SMOKE_DIR"/{package.json,package-lock.json,prisma.config.ts,schema.prisma,smoke.ts,tsconfig.json} "$SMOKE_WORK/"
cd "$SMOKE_WORK"

echo "==> install deps"
npm ci

echo "==> install tarball"
npm install --no-save --package-lock=false "./$TARBALL"

echo "==> prisma generate"
npx prisma generate --schema schema.prisma

echo "==> typecheck"
npx tsc --noEmit

echo "==> run smoke test"
npx tsx smoke.ts

echo "==> smoke test passed"
