/**
 * The Control Tower demo server — HTTP + SSE + Slack wiring (transport and
 * bootstrap; excluded from unit coverage, same rationale as apps/api's
 * index and the Prisma repositories). Every piece of decision logic it
 * calls — the store, controller, decision registry, SSE encoders, Slack
 * signature verification, interaction parsing, principal mapping — is
 * covered on its own. This file only plumbs those together and moves bytes.
 *
 * Endpoints:
 *   GET  /                          the single-page Control Tower UI
 *   GET  /api/stream                Server-Sent Events: snapshot + live deltas
 *   POST /api/trigger               start a scenario (also the incident webhook)
 *   POST /api/incidents/:id/decision   approve/reject from the UI
 *   POST /slack/events              Slack Events API (a message opens an incident)
 *   POST /slack/interactions        Slack Approve/Reject button callbacks
 *   GET  /healthz
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Controller, type TriggerContext } from "./controller.js";
import { DecisionRegistry } from "./decision-registry.js";
import { IncidentStore } from "./incident-store.js";
import { encodeSse, heartbeat, incidentMessage, snapshotMessage } from "./sse.js";
import { scenarioKeyFromText } from "./scenarios.js";
import { Presenter } from "./engine/presenter.js";
import { runScenario } from "./engine/run-scenario.js";
import { createSlackClient, type SlackClient } from "./slack/slack-client.js";
import { verifySlackSignature } from "./slack/verify-signature.js";
import { parseInteractionPayload } from "./slack/parse-interaction.js";
import { parseUserMap, resolvePrincipal } from "./slack/principal-map.js";

export interface ServerConfig {
  slackBotToken?: string | undefined;
  slackSigningSecret?: string | undefined;
  slackChannel?: string | undefined;
  slackUserMap?: string | undefined;
  logger?: boolean | undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, "..", "public", "index.html");

interface RawBodyRequest extends FastifyRequest {
  rawBody?: string;
}

export function buildServer(config: ServerConfig = {}): FastifyInstance {
  const app = Fastify({ logger: config.logger ?? false });

  const store = new IncidentStore();
  const decisions = new DecisionRegistry();
  const slack: SlackClient = createSlackClient(config.slackBotToken);
  const userMap = parseUserMap(config.slackUserMap);
  const now = (): Date => new Date();
  let demoPlaybackDelayMs = 1200;

  // The real engine runner: build a Presenter that fans out to the store
  // (UI over SSE) and Slack, then run the governed pipeline. Fire-and-forget.
  const run = (ctx: TriggerContext): void => {
    const presenter = new Presenter({
      incidentId: ctx.incidentId,
      store,
      slack,
      channel: ctx.slackChannel ?? config.slackChannel,
      threadTs: ctx.slackThreadTs,
      now,
      pacingMs: ctx.paced ? () => demoPlaybackDelayMs : undefined,
    });
    void runScenario({ scene: ctx.scenario.scene, incidentId: ctx.incidentId, store, decisions, presenter, now });
  };

  const controller = new Controller({ store, decisions, run, now });

  // Slack listener health, surfaced to the UI's listener card. Events API is
  // the primary, event-driven path; a heartbeat timestamp lets the UI show
  // liveness. (A periodic reconciliation poll for missed-event detection is
  // the documented production next step.)
  let lastSlackEventAt: string | undefined;
  const listenerHealth = (): Record<string, unknown> => ({
    enabled: slack.enabled,
    channel: config.slackChannel ?? null,
    mode: slack.enabled ? "Events API" : "Simulator",
    verification: config.slackSigningSecret ? "Signature valid" : "unverified",
    lastEventAt: lastSlackEventAt ?? null,
    heartbeatAt: now().toISOString(),
  });

  // Capture raw bodies so Slack signatures can be verified over exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body: string, done) => {
    (req as RawBodyRequest).rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body: string, done) => {
    (req as RawBodyRequest).rawBody = body;
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });

  app.get("/", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return readFileSync(INDEX_HTML, "utf8");
  });

  app.get("/healthz", async () => ({ ok: true, slack: slack.enabled }));

  // Listener health for the UI's "Slack listener" card.
  app.get("/api/listener", async () => listenerHealth());

  app.get("/api/playback", async () => ({ delayMs: demoPlaybackDelayMs }));
  app.post("/api/playback", async (req) => {
    const body = (req.body ?? {}) as { delayMs?: number };
    if (Number.isFinite(body.delayMs)) {
      demoPlaybackDelayMs = Math.max(150, Math.min(3000, Math.round(body.delayMs!)));
    }
    return { delayMs: demoPlaybackDelayMs };
  });

  // ── SSE stream ──
  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(encodeSse(snapshotMessage(store.list())));
    const unsubscribe = store.subscribe((incident) => {
      reply.raw.write(encodeSse(incidentMessage(incident)));
    });
    const hb = setInterval(() => reply.raw.write(heartbeat()), 15000);
    req.raw.on("close", () => {
      clearInterval(hb);
      unsubscribe();
    });
  });

  // ── trigger a scenario (UI button, or an external incident webhook) ──
  app.post("/api/trigger", async (req, reply) => {
    const body = (req.body ?? {}) as { key?: string; scene?: number; subject?: string; source?: string; playbackDelayMs?: number };
    // Honest ingress label: default SIMULATOR; the Demo Lab sends DEMO.
    const source = body.source === "DEMO" ? "DEMO" : "SIMULATOR";
    if (Number.isFinite(body.playbackDelayMs)) {
      demoPlaybackDelayMs = Math.max(150, Math.min(3000, Math.round(body.playbackDelayMs!)));
    }
    const result = controller.trigger({ key: body.key, scene: body.scene, subject: body.subject, source, paced: true });
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason });
    }
    return { incidentId: result.incidentId, scene: result.scenario.scene };
  });

  // ── approve / reject from the UI ──
  app.post("/api/incidents/:id/decision", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { decision?: string; actorId?: string };
    const decision = body.decision === "APPROVED" || body.decision === "REJECTED" ? body.decision : undefined;
    if (!decision) {
      return reply.code(400).send({ error: "decision must be APPROVED or REJECTED" });
    }
    const actorId = body.actorId?.trim() || "riley-lead";
    const settled = controller.decide(id, decision, actorId, "ui");
    // On a losing click, report who actually decided so the UI can say
    // "Decision already recorded by X via Slack" instead of a false failure.
    if (!settled) {
      const a = store.get(id)?.approval;
      return { settled, decidedBy: a?.decidedBy ?? null, decidedVia: a?.decidedVia ?? null, decision: a?.decision ?? null };
    }
    return { settled };
  });

  // ── Slack Events API: a message/mention opens an incident ──
  app.post("/slack/events", async (req: RawBodyRequest, reply) => {
    const body = (req.body ?? {}) as {
      type?: string;
      challenge?: string;
      event?: { type?: string; text?: string; bot_id?: string; channel?: string; ts?: string; thread_ts?: string };
    };

    if (body.type === "url_verification") {
      return { challenge: body.challenge };
    }

    if (!verifyOrReject(req, reply, config.slackSigningSecret)) {
      return reply;
    }

    lastSlackEventAt = now().toISOString();
    const event = body.event;
    // Ignore our own bot's messages to avoid trigger loops.
    if (event && !event.bot_id && (event.type === "app_mention" || event.type === "message")) {
      const key = scenarioKeyFromText(event.text ?? "");
      controller.trigger({
        key,
        subject: event.text,
        source: "SLACK",
        slackChannel: event.channel,
        slackThreadTs: event.thread_ts ?? event.ts,
      });
    }
    return { ok: true };
  });

  // ── Slack interactivity: Approve/Reject button callbacks ──
  app.post("/slack/interactions", async (req: RawBodyRequest, reply) => {
    if (!verifyOrReject(req, reply, config.slackSigningSecret)) {
      return reply;
    }
    const body = (req.body ?? {}) as { payload?: string };
    const parsed = parseInteractionPayload(body.payload ?? "");
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.reason });
    }
    const principal = resolvePrincipal(parsed.interaction.slackUserId, userMap);
    controller.decide(parsed.interaction.incidentId, parsed.interaction.decision, principal, "slack");
    // 200 with empty body; the Presenter updates the card via chat.update.
    return reply.code(200).send();
  });

  return app;
}

/**
 * Verifies a Slack request signature when a signing secret is configured.
 * With no secret (local UI-only dev) the Slack routes are effectively
 * disabled: we refuse rather than trust an unverifiable request. Returns
 * true only when the caller may proceed.
 */
function verifyOrReject(req: RawBodyRequest, reply: FastifyReply, signingSecret: string | undefined): boolean {
  if (!signingSecret) {
    reply.code(401).send({ error: "slack not configured" });
    return false;
  }
  const result = verifySlackSignature({
    signingSecret,
    rawBody: req.rawBody ?? "",
    signatureHeader: req.headers["x-slack-signature"] as string | undefined,
    timestampHeader: req.headers["x-slack-request-timestamp"] as string | undefined,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!result.ok) {
    reply.code(401).send({ error: `slack signature: ${result.reason}` });
    return false;
  }
  return true;
}
