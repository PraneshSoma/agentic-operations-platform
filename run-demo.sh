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

# Usage:
#   ./run-demo.sh            # narrated CLI demo (default)
#   ./run-demo.sh ui         # interactive web Control Tower on :4000
#
# For the UI with real Slack, export these before running (all optional —
# without them the UI runs standalone, no Slack):
#   SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL, SLACK_USER_MAP
# If the `ngrok` CLI is installed and Slack creds are set, `ui` mode also
# opens a public tunnel so Slack can reach your machine.
MODE="${1:-cli}"

REPO_URL="https://github.com/PraneshSoma/agentic-operations-platform.git"
REPO_DIR="agentic-operations-platform"
PORT="${PORT:-4000}"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

case "$MODE" in
  cli|ui) ;;
  *) die "Unknown mode '$MODE'. Use: ./run-demo.sh   (CLI)   or   ./run-demo.sh ui" ;;
esac

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
# Load local secrets if present (git-ignored). `.env.local` wins over `.env`.
# `set -a` exports everything the file assigns, so SLACK_* reach the server.
# Runs from the repo root, which we're now inside.
for envfile in .env.local .env; do
  if [ -f "$envfile" ]; then
    say "Loading environment from $envfile"
    set -a; . "./$envfile"; set +a
    break
  fi
done

if [ "$MODE" = "cli" ]; then
  say "Launching the narrated CLI demo"
  pnpm demo
  exit 0
fi

if [ "$MODE" != "ui" ]; then
  die "Unknown mode '$MODE'. Use: ./run-demo.sh   (CLI)   or   ./run-demo.sh ui"
fi

# Interactive UI mode.
if [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_SIGNING_SECRET:-}" ]; then
  say "Slack: enabled (channel ${SLACK_CHANNEL:-<unset — set SLACK_CHANNEL to post UI-triggered incidents>})"
  # If ngrok is available, open a public tunnel so Slack can reach us.
  if command -v ngrok >/dev/null 2>&1; then
    say "Opening an ngrok tunnel to :$PORT (for Slack callbacks)…"
    ngrok http "$PORT" --log=stdout >/tmp/aop-ngrok.log 2>&1 &
    NGROK_PID=$!
    trap 'kill "$NGROK_PID" 2>/dev/null || true' EXIT
    # Give ngrok a moment, then read the public URL from its local API.
    sleep 3
    PUBLIC_URL="$(curl -s http://127.0.0.1:4040/api/tunnels | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).tunnels||[];const h=t.find(x=>x.public_url&&x.public_url.startsWith("https"))||t[0];process.stdout.write(h?h.public_url:"")}catch(e){}})' 2>/dev/null || true)"
    if [ -n "$PUBLIC_URL" ]; then
      printf '\n\033[1;32m▶ Public URL: %s\033[0m\n' "$PUBLIC_URL"
      printf '   Set these in your Slack app settings:\n'
      printf '     Interactivity Request URL : %s/slack/interactions\n' "$PUBLIC_URL"
      printf '     Events Request URL        : %s/slack/events\n\n' "$PUBLIC_URL"
    else
      say "Couldn't read the ngrok URL automatically — check /tmp/aop-ngrok.log or the ngrok UI at http://127.0.0.1:4040"
    fi
  else
    say "ngrok not found — Slack callbacks need a public URL. Install ngrok (https://ngrok.com) or run 'cloudflared tunnel --url http://localhost:$PORT' in another terminal, then set the two Request URLs in your Slack app."
  fi
else
  say "Slack: disabled (UI-only). Export SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET to enable it."
fi

say "Launching the Control Tower UI → http://localhost:$PORT"
PORT="$PORT" pnpm ui
