/**
 * Scene catalogue for the interactive demo — the six things the audience
 * can trigger. Scene 1 is the governed happy path (the only one with a live
 * approval gate); scenes 2–6 are the five guardrails, each a deliberate
 * attempt to do the wrong thing that the platform refuses. Kept as plain
 * data so the UI, the trigger routes, and the engine all agree on the same
 * list without duplicating it.
 */

export interface Scenario {
  scene: number;
  /** Stable slug used in URLs and Slack action payloads. */
  key: string;
  title: string;
  /** One-line description shown on the trigger button. */
  blurb: string;
  /** True only for the happy path, which parks at a live approval gate. */
  hasApprovalGate: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    scene: 1,
    key: "happy-path",
    title: "An incident, governed end to end",
    blurb: "Investigate → plan → approve → act → verify, fully audited",
    hasApprovalGate: true,
  },
  {
    scene: 2,
    key: "ambiguous",
    title: "Profile / wallet mismatch — refuses to guess",
    blurb: "A customer state mismatch ties profile and wallet procedures → escalates",
    hasApprovalGate: false,
  },
  {
    scene: 3,
    key: "frozen-plan",
    title: "Wallet limit mutation — approval binds the exact value",
    blurb: "A $5,000 approved wallet limit is changed to $50,000 → blocked",
    hasApprovalGate: false,
  },
  {
    scene: 4,
    key: "preflight-drift",
    title: "Wallet ledger drift — balance changed since approval",
    blurb: "The wallet revision changes after approval → execution is refused",
    hasApprovalGate: false,
  },
  {
    scene: 5,
    key: "emergency-halt",
    title: "Customer profile merge — emergency halt",
    blurb: "An unauthorized halt is refused; an authorized profile-merge halt is audited",
    hasApprovalGate: false,
  },
  {
    scene: 6,
    key: "budget",
    title: "Wallet investigation budget — no half-answers",
    blurb: "A wallet-risk investigation exceeds its ceiling → escalates, never truncates",
    hasApprovalGate: false,
  },
] as const;

export function scenarioByKey(key: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

export function scenarioByScene(scene: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.scene === scene);
}

/**
 * Picks a scenario from free-text (a Slack message body). Matches a scene
 * number ("scene 3", "3") or any scenario key/keyword found in the text;
 * defaults to the happy path when nothing matches, so simply @-mentioning
 * the bot triggers the governed end-to-end run.
 */
export function scenarioKeyFromText(text: string): string {
  const lower = text.toLowerCase();
  const sceneNum = /\bscene\s*(\d+)\b/.exec(lower) ?? /\b(\d+)\b/.exec(lower);
  if (sceneNum) {
    const s = scenarioByScene(Number(sceneNum[1]));
    if (s) {
      return s.key;
    }
  }
  for (const s of SCENARIOS) {
    if (lower.includes(s.key)) {
      return s.key;
    }
  }
  return SCENARIOS[0]!.key;
}
