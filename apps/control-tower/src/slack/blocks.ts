/**
 * Block Kit message builders (pure). These produce the JSON blocks the
 * Slack Web API renders — the incident announcement, the interactive
 * approval card with Approve/Reject buttons, and the resolved-approval
 * card that replaces it once someone acts (from Slack OR the UI).
 *
 * Pure functions returning plain objects, so the exact Slack payloads are
 * unit-testable without touching the network. slack-client.ts posts them.
 */
import type { Incident } from "../incident-store.js";

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

/** The action_id prefix Slack sends back when a button is clicked. */
export const APPROVE_ACTION_ID = "aop_approve";
export const REJECT_ACTION_ID = "aop_reject";

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

function bullets(items: string[] | undefined, fallback: string): string {
  return (items?.length ? items : [fallback]).map((item) => `• ${item}`).join("\n");
}

/** The root message announcing a new incident — everything threads under it. */
export function incidentAnnouncementBlocks(incident: Incident): SlackBlock[] {
  return [
    section(`:rotating_light: *${incident.severity ?? "P2"} incident ${incident.id}*\n${incident.subject}`),
    section(
      [
        `*Affected service:* \`${incident.service ?? "unknown"}\``,
        `*Detection source:* \`${incident.source ?? "unknown"}\``,
        `*Operating mode:* ${incident.mode ?? "Auto investigation"}`,
        `*Human gate:* ${incident.humanGate ?? "Policy controlled"}`,
      ].join("\n"),
    ),
    section("*Suspected dependency path*\n`profile database` → `customer-profile API` → `wallet authorization` → `customer transaction`"),
    context(`Scene ${incident.scene} · ${incident.sceneTitle} · all findings and actions will be recorded in this thread`),
  ];
}

/** A short status line posted into the incident's thread as the pipeline moves. */
export function statusUpdateText(incident: Incident, line: string): string {
  const purpose: Partial<Record<Incident["lane"], string>> = {
    RECEIVED: "Impact reproduction",
    OPC_MATCHED: "Operating procedure selection",
    CONTEXT: "Dependency and telemetry context",
    INVESTIGATING: "Evidence correlation",
    DIAGNOSED: "Evidence-backed root cause",
    PLANNED: "Frozen remediation plan",
    WAITING_APPROVAL: "Production change policy",
    EXECUTING: "Authorized remediation",
    VERIFYING: "Post-change validation",
    RESOLVED: "Verified recovery",
  };
  return `*${incident.lane} · ${purpose[incident.lane] ?? "Lifecycle update"}*\n${line}\n_Incident ${incident.id} · ${incident.service ?? "unknown service"}_`;
}

/**
 * The interactive approval card. `value` on each button carries the
 * incident id so the interaction callback knows what to resolve. Rendered
 * only for the happy path, which is the one scene with a live gate.
 */
export function approvalRequestBlocks(incident: Incident): SlackBlock[] {
  const a = incident.approval;
  const params = a ? JSON.stringify(a.parameters) : "{}";
  return [
    section(`:lock: *Production remediation approval required*\nIncident *${incident.id}* · ${incident.subject}`),
    section(`*Customer impact observed*\n${bullets(a?.impact, "Impact evidence unavailable")}`),
    section(
      [
        `*Proposed action:* \`${a?.action ?? "unknown"}\``,
        `*Why this action:* ${a?.reason ?? ""}`,
        `*Change parameters:* \`${params}\``,
      ].join("\n"),
    ),
    section(`*Execution plan*\n${(a?.remediationSteps?.length ? a.remediationSteps : ["No detailed steps supplied"]).map((step, index) => `${index + 1}. ${step}`).join("\n")}`),
    section(`*Verification required before closure*\n${bullets(a?.successCriteria, "Standard post-action verification")}`),
    section(`*Rollback / fail-safe*\n${a?.rollbackPlan ?? "Stop execution and escalate if any verification check fails."}`),
    context(`Proposed by ${a?.proposer ?? "unknown"} · requires ${a?.requiredRole ?? "unknown"} · R2 production change · separation of duties enforced`),
    {
      type: "actions",
      block_id: `approval:${incident.id}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          action_id: APPROVE_ACTION_ID,
          value: incident.id,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Reject" },
          action_id: REJECT_ACTION_ID,
          value: incident.id,
        },
      ],
    },
  ];
}

/**
 * Replaces the approval card once resolved — from either surface — so the
 * Slack thread always reflects the final, single decision. Slack and the UI
 * stay in sync because both drive the same incident, and this card is what
 * the button message becomes.
 */
export function approvalResolvedBlocks(incident: Incident): SlackBlock[] {
  const a = incident.approval;
  const approved = a?.decision === "APPROVED";
  const icon = approved ? ":white_check_mark:" : ":no_entry:";
  const verb = approved ? "Approved" : "Rejected";
  const via = a?.decidedVia === "slack" ? "in Slack" : "in the Control Tower UI";
  return [
    section(`${icon} *Remediation ${verb.toLowerCase()}* — incident *${incident.id}*`),
    section(
      approved
        ? `*Authorized action:* \`${a?.action ?? ""}\`\n*Decision owner:* ${a?.decidedBy ?? "unknown"} ${via}\n*Next:* execute the frozen plan, then run every success criterion before declaring recovery.`
        : `*Rejected action:* \`${a?.action ?? ""}\`\n*Decision owner:* ${a?.decidedBy ?? "unknown"} ${via}\n*Result:* no production change was executed; the incident remains contained and escalated.`,
    ),
    context(`${verb} under the ${a?.requiredRole ?? "unknown"} role · decision recorded in the incident evidence trail`),
  ];
}
