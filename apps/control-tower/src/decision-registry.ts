/**
 * DecisionRegistry — the "approve from anywhere" mechanism.
 *
 * When the governed pipeline reaches the Approval Acceptance Gate it parks,
 * registering a pending decision here and awaiting it. A human can then
 * resolve that decision from EITHER surface — the web Control Tower or a
 * Slack button — and whichever arrives first wins; the other becomes a
 * no-op. This is the whole "it could be a Slack thread and in the UI, can
 * be acted from anywhere" requirement, reduced to one small, race-safe,
 * fully testable primitive with no I/O of its own.
 *
 * Separation of duties (the proposer may not approve their own action) is
 * NOT enforced here — it is enforced downstream by the real Approval
 * Acceptance Gate (@aop/policy-engine's runApprovalAcceptanceGate), which
 * resolves the actor's true identity. This registry only carries the
 * decision from a surface to the waiting pipeline.
 */

export type DecisionChannel = "ui" | "slack";

export interface Decision {
  decision: "APPROVED" | "REJECTED";
  /** The principal id acting — resolved to a real identity downstream. */
  actorId: string;
  via: DecisionChannel;
}

interface Pending {
  resolve: (decision: Decision) => void;
  settled: boolean;
}

export class DecisionRegistry {
  private readonly pending = new Map<string, Pending>();

  /**
   * Registers a pending decision for an incident and returns a promise that
   * settles when someone resolves it. Registering the same incident twice
   * while one is still open is a programming error (an incident parks at
   * the gate exactly once).
   */
  await(incidentId: string): Promise<Decision> {
    if (this.pending.has(incidentId)) {
      throw new Error(`A decision is already pending for ${incidentId}`);
    }
    return new Promise<Decision>((resolve) => {
      this.pending.set(incidentId, { resolve, settled: false });
    });
  }

  /** True while an incident is parked awaiting a decision. */
  isPending(incidentId: string): boolean {
    const p = this.pending.get(incidentId);
    return p !== undefined && !p.settled;
  }

  /**
   * Resolves a parked decision from either surface. Returns true if this
   * call is the one that settled it, false if it was already settled or
   * was never pending (an idempotent late click from the other surface, or
   * a stray callback). The first caller wins.
   */
  resolve(incidentId: string, decision: Decision): boolean {
    const p = this.pending.get(incidentId);
    if (!p || p.settled) {
      return false;
    }
    p.settled = true;
    this.pending.delete(incidentId);
    p.resolve(decision);
    return true;
  }
}
