/**
 * Parses a Slack interactivity payload (a block-action button click) into a
 * normalized decision the DecisionRegistry understands. Pure: it takes the
 * already-url-decoded `payload` JSON string Slack posts and returns either a
 * decision or a typed reason it couldn't. The route does signature
 * verification and body decoding around it.
 */
import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./blocks.js";

export interface ParsedInteraction {
  incidentId: string;
  decision: "APPROVED" | "REJECTED";
  /** The Slack user id that clicked — mapped to a principal downstream. */
  slackUserId: string;
  /** ts of the message the button lived on, so we can update it in place. */
  messageTs?: string | undefined;
  channel?: string | undefined;
}

export type ParseResult =
  | { ok: true; interaction: ParsedInteraction }
  | { ok: false; reason: "unparseable" | "not_block_actions" | "no_action" | "unknown_action" };

interface SlackAction {
  action_id?: unknown;
  value?: unknown;
}

/**
 * `payloadJson` is the value of the `payload` form field Slack sends in an
 * `application/x-www-form-urlencoded` interaction POST.
 */
export function parseInteractionPayload(payloadJson: string): ParseResult {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (payload.type !== "block_actions") {
    return { ok: false, reason: "not_block_actions" };
  }

  const actions = Array.isArray(payload.actions) ? (payload.actions as SlackAction[]) : [];
  const action = actions[0];
  if (!action || typeof action.action_id !== "string" || typeof action.value !== "string") {
    return { ok: false, reason: "no_action" };
  }

  const decision =
    action.action_id === APPROVE_ACTION_ID
      ? ("APPROVED" as const)
      : action.action_id === REJECT_ACTION_ID
        ? ("REJECTED" as const)
        : undefined;
  if (!decision) {
    return { ok: false, reason: "unknown_action" };
  }

  const user = payload.user as { id?: unknown } | undefined;
  const message = payload.message as { ts?: unknown } | undefined;
  const channel = payload.channel as { id?: unknown } | undefined;

  return {
    ok: true,
    interaction: {
      incidentId: action.value,
      decision,
      slackUserId: typeof user?.id === "string" ? user.id : "unknown",
      messageTs: typeof message?.ts === "string" ? message.ts : undefined,
      channel: typeof channel?.id === "string" ? channel.id : undefined,
    },
  };
}
