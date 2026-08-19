# Control Tower — interactive demo

An interactive web UI for the Agentic Operations Platform demo. One incident
trigger, a live board that shows the governed pipeline moving in real time, a
**live approval gate you can act on from the UI or a real Slack thread**, and
buttons to fire the five guardrail scenes. It runs the **same real platform
code** the CLI demo (`pnpm demo`) and the test suite exercise — the UI just
streams it.

```
┌──────────── trigger ────────────┐        ┌──────── act from anywhere ───────┐
 UI button  ─┐                              UI "Approve"  ─┐
 Slack msg  ─┤─► governed pipeline ──park──► Slack button ─┤─► first one wins
 webhook    ─┘        (real @aop)     at gate               └─► other = no-op
                          │
                          ▼   Server-Sent Events
                   live board + Slack thread, always in sync
```

## Run it (UI only — no Slack, no database)

From the repo root:

```bash
pnpm install
pnpm ui              # starts on http://localhost:4000
```

Open <http://localhost:4000>. Click **▶ Trigger incident** to run the governed
happy path — it parks at the approval gate; click **Approve (as riley-lead)**
and watch it execute, verify, and resolve. The five **Scene N** buttons fire
the guardrails (ambiguous ticket, frozen plan, preflight drift, emergency
halt, budget) — each one is refused, live.

The Slack pill in the header reads **UI-only** until you wire Slack below.

## Turn on real Slack (approve from a Slack thread)

Slack integration is entirely optional and reads its credentials from the
environment — **nothing secret is ever committed.** You need to do three
things Claude can't do for you: create a Slack app, and expose this server
with a public URL.

### 1. Create a Slack app

- Go to <https://api.slack.com/apps> → **Create New App** → *From scratch*.
- **OAuth & Permissions** → Bot Token Scopes: add `chat:write`,
  `app_mentions:read`, `channels:history` (and `groups:history` for private
  channels). Install to your workspace and copy the **Bot User OAuth Token**
  (`xoxb-…`).
- **Basic Information** → copy the **Signing Secret**.
- Invite the bot to a channel (`/invite @yourbot`) and copy that channel's ID
  (right-click the channel → *Copy link*; the `C0…` at the end is the id).

### 2. Expose this server publicly

Slack must reach your machine. In a second terminal:

```bash
ngrok http 4000            # or: cloudflared tunnel --url http://localhost:4000
```

Copy the public `https://…` URL it prints.

- **Interactivity & Shortcuts** → turn on → Request URL:
  `https://…/slack/interactions`
- **Event Subscriptions** → turn on → Request URL: `https://…/slack/events`
  (Slack sends a one-time challenge — the server answers it automatically).
  Under *Subscribe to bot events* add `app_mention` (and `message.channels`
  if you want any message in the channel to open an incident). Reinstall the
  app if prompted.

### 3. Start the server with the credentials

Put your secrets in a git-ignored `.env.local` at the repo root (never
committed — `.gitignore` already excludes `.env.*`):

```bash
cp .env.example .env.local        # then edit .env.local with your real values
./run-demo.sh ui                  # sources .env.local automatically
```

`.env.local` holds:

```bash
export SLACK_BOT_TOKEN=xoxb-…
export SLACK_SIGNING_SECRET=…
export SLACK_CHANNEL=C0…          # channel to post UI-triggered incidents into
# optional: bind Slack users to demo principals (approver must differ from the
# proposer sam-oncall; unmapped users act as riley-lead by default)
export SLACK_USER_MAP="U0YOURID:riley-lead"
```

Or export them by hand and run `pnpm ui` — same effect. `./run-demo.sh ui`
additionally opens an ngrok tunnel (if installed) and prints the two Slack
Request URLs to paste back into the app.

Now the loop is closed:

- **@-mention the bot** in the channel (e.g. "@bot checkout is throwing 500s")
  → an incident opens, threads its progress, and posts an **Approve / Reject**
  card when it reaches the gate. Add "scene 3" etc. to fire a guardrail.
- Click **Approve** in Slack *or* in the UI — whichever acts first wins, the
  Slack card rewrites to the decision, and the UI updates over SSE. Try it
  both ways.

> Real Slack's button callback can only be exercised end-to-end on a machine
> with your Slack app + a public tunnel — it can't be tested from inside a
> sandbox. The UI-only path needs none of that and is fully deterministic.

## What's real, what's simulated

- **Real:** the governed pipeline (OPC match → context → investigation → frozen
  plan → policy → approval gate → preflight → execute → verify → evidence
  ledger), every guardrail, the separation-of-duties check (the proposer
  cannot approve their own action — try approving *as sam-oncall* in the UI and
  it escalates), the Slack signature verification.
- **Simulated by design:** the action connector (a sandbox), the LLM provider
  (a fixed transcript so the demo is deterministic), and the identity
  directory. Real production connectors are the explicitly-scoped next phase.

## How it's built

| Concern | File |
| --- | --- |
| Incident state + change fan-out (SSE source) | `src/incident-store.ts` |
| Approve-from-anywhere (race-safe, first wins) | `src/decision-registry.ts` |
| Scenario catalogue | `src/scenarios.ts` |
| SSE wire format | `src/sse.ts` |
| Orchestration seam (id alloc, decision routing) | `src/controller.ts` |
| Slack signature verify / blocks / interaction parse / principal map | `src/slack/*` |
| The event-emitting pipeline (all six scenes) | `src/engine/run-scenario.ts` |
| HTTP + SSE + Slack wiring | `src/server.ts` |
| The single-page UI | `public/index.html` |

Everything except the transport (`server.ts`), the presentation engine
(`engine/**`, which drives the real `@aop` packages live, like `apps/demo`),
and the Slack network client is unit-tested to 100% in `pnpm test`.
