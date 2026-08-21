/**
 * Presenter — the one place the engine's semantic events fan out to both
 * surfaces at once: the in-memory store (which drives the live UI over SSE)
 * and a real Slack thread. This is what makes "show it in the UI AND in a
 * Slack thread, act from anywhere" a single code path rather than two.
 *
 * Excluded from unit coverage (it performs Slack network I/O). The pure
 * pieces it composes — the store mutations, the Block Kit builders — are
 * covered on their own. Slack failures are swallowed so a missing/broken
 * Slack app never breaks the UI-only demo.
 */
import type { AnalysisView, ApprovalRequest, IncidentStore, Lane, TrustEnvelope } from "../incident-store.js";
import {
  approvalRequestBlocks,
  approvalResolvedBlocks,
  incidentAnnouncementBlocks,
  statusUpdateText,
} from "../slack/blocks.js";
import type { SlackClient } from "../slack/slack-client.js";

export interface PresenterDeps {
  incidentId: string;
  store: IncidentStore;
  slack: SlackClient;
  /** Channel to post into, if Slack is wired. */
  channel?: string | undefined;
  /** Existing thread ts when the incident was triggered from a Slack message. */
  threadTs?: string | undefined;
  now: () => Date;
  /** Current delay between visible lifecycle lanes for interactive demos. */
  pacingMs?: (() => number) | undefined;
}

export class Presenter {
  private channel: string | undefined;
  private threadTs: string | undefined;

  constructor(private readonly deps: PresenterDeps) {
    this.channel = deps.channel;
    this.threadTs = deps.threadTs;
  }

  private at(): string {
    return this.deps.now().toISOString();
  }

  /** Announce the incident in Slack (opening or reusing a thread). */
  async start(): Promise<void> {
    const incident = this.deps.store.get(this.deps.incidentId);
    if (!incident || !this.deps.slack.enabled || !this.channel) {
      return;
    }
    try {
      if (this.threadTs) {
        // Triggered from an existing Slack message — thread under it.
        await this.deps.slack.postMessage({
          channel: this.channel,
          text: `Incident ${incident.id} opened`,
          blocks: incidentAnnouncementBlocks(incident),
          threadTs: this.threadTs,
        });
        this.deps.store.setSlack(incident.id, this.at(), { channel: this.channel, threadTs: this.threadTs });
      } else {
        const res = await this.deps.slack.postMessage({
          channel: this.channel,
          text: `Incident ${incident.id} opened`,
          blocks: incidentAnnouncementBlocks(incident),
        });
        this.threadTs = res.ts;
        this.deps.store.setSlack(incident.id, this.at(), { channel: this.channel, threadTs: res.ts });
      }
    } catch {
      /* Slack is best-effort for the demo; the UI is the source of truth. */
    }
  }

  private async postThread(line: string): Promise<void> {
    const incident = this.deps.store.get(this.deps.incidentId);
    if (!incident || !this.deps.slack.enabled || !this.channel || !this.threadTs) {
      return;
    }
    try {
      await this.deps.slack.postMessage({
        channel: this.channel,
        threadTs: this.threadTs,
        text: statusUpdateText(incident, line),
      });
    } catch {
      /* best-effort */
    }
  }

  async lane(lane: Lane): Promise<void> {
    this.deps.store.setLane(this.deps.incidentId, this.at(), lane);
    const delay = Math.max(0, this.deps.pacingMs?.() ?? 0);
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  /** Sets the current-analysis card (store-only, no Slack side effect). */
  async analysis(view: AnalysisView): Promise<void> {
    this.deps.store.setAnalysis(this.deps.incidentId, this.at(), view);
  }

  /** Merges fields into the trust envelope (store-only, no Slack side effect). */
  async trust(patch: TrustEnvelope): Promise<void> {
    this.deps.store.setTrust(this.deps.incidentId, this.at(), patch);
  }

  async step(text: string): Promise<void> {
    this.deps.store.append(this.deps.incidentId, this.at(), { kind: "step", text });
  }

  async ok(text: string, evidenceType?: string): Promise<void> {
    this.deps.store.append(this.deps.incidentId, this.at(), { kind: "ok", text, evidenceType });
    await this.postThread(`✅ ${text}`);
  }

  async blocked(text: string): Promise<void> {
    this.deps.store.append(this.deps.incidentId, this.at(), { kind: "blocked", text });
    await this.postThread(`🛑 ${text}`);
  }

  async why(text: string): Promise<void> {
    this.deps.store.append(this.deps.incidentId, this.at(), { kind: "why", text });
  }

  /** Records the approval request in the store and posts the Slack card. */
  async requestApproval(approval: ApprovalRequest): Promise<void> {
    this.deps.store.setApproval(this.deps.incidentId, this.at(), approval);
    this.deps.store.append(this.deps.incidentId, this.at(), {
      kind: "approval",
      text: `Approval required: ${approval.action} ${JSON.stringify(approval.parameters)}`,
    });
    const incident = this.deps.store.get(this.deps.incidentId);
    if (!incident || !this.deps.slack.enabled || !this.channel) {
      return;
    }
    try {
      const res = await this.deps.slack.postMessage({
        channel: this.channel,
        threadTs: this.threadTs,
        text: `Approval required for ${incident.id}`,
        blocks: approvalRequestBlocks(incident),
      });
      if (res.ts) {
        this.deps.store.setSlack(incident.id, this.at(), {
          channel: this.channel,
          threadTs: this.threadTs,
          approvalTs: res.ts,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  /** Rewrites the Slack approval card in place after a decision from either surface. */
  async resolveApproval(): Promise<void> {
    const incident = this.deps.store.get(this.deps.incidentId);
    if (!incident) {
      return;
    }
    const decision = incident.approval?.decision;
    this.deps.store.append(this.deps.incidentId, this.at(), {
      kind: "decision",
      text: `${decision} by ${incident.approval?.decidedBy} (via ${incident.approval?.decidedVia})`,
    });
    if (!this.deps.slack.enabled || !incident.slack?.channel || !incident.slack.approvalTs) {
      return;
    }
    try {
      await this.deps.slack.updateMessage({
        channel: incident.slack.channel,
        ts: incident.slack.approvalTs,
        text: `Approval ${decision} for ${incident.id}`,
        blocks: approvalResolvedBlocks(incident),
      });
    } catch {
      /* best-effort */
    }
  }
}
