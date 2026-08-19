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

/** The root message announcing a new incident — everything threads under it. */
export function incidentAnnouncementBlocks(incident: Incident): SlackBlock[] {
  return [
    section(`:rotating_light: *Incident ${incident.id}* — ${incident.subject}`),
    context(`Scene ${incident.scene} · ${incident.sceneTitle} · reported via Slack`),
  ];
}

/** A short status line posted into the incident's thread as the pipeline moves. */
export function statusUpdateText(incident: Incident, line: string): string {
  return `\`${incident.lane}\`  ${line}`;
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
    section(`:lock: *Approval required* for incident *${incident.id}*`),
    section(
      [
        `*Action:* \`${a?.action ?? "unknown"}\``,
        `*Parameters:* \`${params}\``,
        `*Proposed by:* ${a?.proposer ?? "unknown"}`,
        `*Requires role:* \`${a?.requiredRole ?? "unknown"}\``,
        `*Why:* ${a?.reason ?? ""}`,
      ].join("\n"),
    ),
    context("A _different_ person than the proposer must approve — the action runs under the approver's identity."),
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
    section(`${icon} *${verb}* — incident *${incident.id}*`),
    context(`${verb} by ${a?.decidedBy ?? "unknown"} ${via} · action \`${a?.action ?? ""}\``),
  ];
}
