#!/usr/bin/env bash
#
# One-shot setup + run for the Agentic Operations Platform demo.
# Safe to run from anywhere: clones the repo if you're not already in it,
# sets up pnpm, installs, generates the Prisma client, and runs the demo.
#
#   curl -fsSL <raw-url>/run-demo.sh | bash      # or:
#   ./run-demo.sh
#
set -euo pipefail

REPO_URL="https://github.com/PraneshSoma/agentic-operations-platform.git"
REPO_DIR="agentic-operations-platform"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Node 20+ ──────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 20+ (https://nodejs.org) and re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v)). Please upgrade."
say "Node $(node -v) OK"

# ── 2. Locate or clone the repo ──────────────────────────────────────────
if grep -q '"name": "agentic-operations-platform"' package.json 2>/dev/null; then
  say "Already in the repo ($(pwd))"
elif [ -d "$REPO_DIR" ]; then
  say "Found ./$REPO_DIR — entering it"; cd "$REPO_DIR"
else
  command -v git >/dev/null 2>&1 || die "git not found and repo not present. Install git or clone the repo manually."
  say "Cloning $REPO_URL"; git clone --depth 1 "$REPO_URL"; cd "$REPO_DIR"
fi

# ── 3. pnpm (via corepack, bundled with Node) ────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  say "Enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || die "Couldn't enable pnpm. Run 'npm install -g pnpm' and re-run this script."
fi
command -v pnpm >/dev/null 2>&1 || die "pnpm still not on PATH. Run 'npm install -g pnpm' and re-run."
say "pnpm $(pnpm -v) OK"

# ── 4. Install (postinstall generates the Prisma client) ─────────────────
say "Installing dependencies (first run takes a minute)…"
pnpm install

# Defensive: ensure the Prisma client exists even if lifecycle scripts were
# skipped (some locked-down setups disable them). Idempotent.
say "Ensuring Prisma client is generated…"
pnpm --filter @aop/evidence-ledger exec prisma generate >/dev/null

# ── 5. Run the demo ──────────────────────────────────────────────────────
say "Launching the demo"
pnpm demo
