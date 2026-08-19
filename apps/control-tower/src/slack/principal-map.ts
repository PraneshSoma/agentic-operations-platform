/**
 * Maps a Slack user id to an AOP principal id for the demo. Real Slack
 * users don't carry AOP identities, so the demo lets you bind them: set
 * `SLACK_USER_MAP="U0123:riley-lead,U0456:sam-oncall"` to say "this Slack
 * person acts as this principal." Anyone unmapped falls back to the demo's
 * default approver (riley-lead, a senior_oncall who is NOT the proposer),
 * so a Slack click still satisfies the Approval Acceptance Gate's
 * separation-of-duties check out of the box.
 *
 * Pure parsing + lookup, so it's fully unit-testable; the route reads the
 * env var and passes the string in.
 */
export const DEFAULT_APPROVER_PRINCIPAL = "riley-lead";

/** Parses "U1:riley-lead,U2:sam-oncall" into a lookup map. Bad entries are skipped. */
export function parseUserMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) {
    return map;
  }
  for (const pair of raw.split(",")) {
    const [slackId, principal] = pair.split(":").map((s) => s.trim());
    if (slackId && principal) {
      map.set(slackId, principal);
    }
  }
  return map;
}

export function resolvePrincipal(
  slackUserId: string,
  map: Map<string, string>,
  fallback: string = DEFAULT_APPROVER_PRINCIPAL,
): string {
  return map.get(slackUserId) ?? fallback;
}
