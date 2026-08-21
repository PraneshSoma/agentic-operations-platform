/**
 * In-memory incident store for the interactive Control Tower demo.
 *
 * This is the single source of truth the live UI and Slack both read from
 * and write to. It is deliberately pure and synchronous: every mutation is
 * a small, total function that returns the updated incident, and a change
 * listener fan-out drives the SSE stream. Nothing here talks to a network
 * or a clock it doesn't own — the scenario engine passes timestamps in — so
 * the whole store is unit-testable without any I/O.
 *
 * It is NOT the evidence ledger. The ledger (packages/evidence-ledger) is
 * the durable, append-only, tenant-isolated system of record the governed
 * pipeline writes; this store is an ephemeral read-model for a single demo
 * session, thrown away when the process exits.
 */

/** The lanes shown on the Control Tower board, in pipeline order. */
export const LANES = [
  "RECEIVED",
  "OPC_MATCHED",
  "CONTEXT",
  "INVESTIGATING",
  "DIAGNOSED",
  "PLANNED",
  "WAITING_APPROVAL",
  "EXECUTING",
  "VERIFYING",
  "RESOLVED",
] as const;

export type Lane = (typeof LANES)[number];

/** Terminal outcomes a guardrail can drive an incident to. */
export type IncidentStatus =
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "RESOLVED"
  | "BLOCKED"
  | "ESCALATED"
  | "HALTED"
  | "REJECTED"
  | "FAILED";

export type TimelineKind = "step" | "ok" | "blocked" | "why" | "approval" | "decision";

export interface TimelineEntry {
  seq: number;
  at: string;
  kind: TimelineKind;
  text: string;
  /** Evidence type when this entry corresponds to a ledger record. */
  evidenceType?: string | undefined;
}

export type DecisionChannel = "ui" | "slack";

export interface ApprovalRequest {
  proposer: string;
  /** The role the policy engine says the approver must hold. */
  requiredRole: string;
  action: string;
  parameters: Record<string, unknown>;
  reason: string;
  /** Operator-facing context rendered in the Slack approval briefing. */
  impact?: string[] | undefined;
  remediationSteps?: string[] | undefined;
  successCriteria?: string[] | undefined;
  rollbackPlan?: string | undefined;
  /** Filled once someone acts, from the UI or from Slack. */
  decision?: "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedVia?: DecisionChannel;
  decidedAt?: string;
}

export interface SlackLink {
  channel: string;
  /** ts of the root incident message — every update threads under it. */
  threadTs?: string | undefined;
  /** ts of the interactive approval message, so we can update it in place. */
  approvalTs?: string | undefined;
}

export type IncidentSeverity = "P1" | "P2" | "P3";

/** Where the incident entered from — labeled honestly (never claim SLACK for a simulated event). */
export type IncidentSource = "SLACK" | "SIMULATOR" | "DEMO";

/**
 * The "what is the system doing now" view for the current-decision card.
 * Deliberately carries NO single fabricated confidence percentage — this
 * platform's differentiator is itemized, evidence-grounded confidence, so
 * we surface the real grounded-claim counts instead of an invented rollup.
 */
export interface AnalysisView {
  likelyCause: string;
  claims: number;
  grounded: number;
  missingContext: number;
  staleContext: number;
}

/**
 * The trust envelope — the audit-integrity summary the right inspector
 * renders. Every field is a real value produced by the governed pipeline,
 * not decoration.
 */
export interface TrustEnvelope {
  procedure?: string | undefined;
  procedureVersion?: string | undefined;
  /** e.g. "4/4" fresh. */
  contextFresh?: string | undefined;
  /** e.g. "6/6" evidence-grounded. */
  claims?: string | undefined;
  planIntegrity?: string | undefined;
  planHash?: string | undefined;
  policy?: string | undefined;
  authorization?: string | undefined;
  /** SANDBOX vs REAL — honest connector labeling. */
  connector?: string | undefined;
  ledger?: number | undefined;
}

export interface Incident {
  id: string;
  scene: number;
  sceneTitle: string;
  subject: string;
  lane: Lane;
  status: IncidentStatus;
  severity?: IncidentSeverity | undefined;
  service?: string | undefined;
  source?: IncidentSource | undefined;
  /** e.g. "Auto investigation". */
  mode?: string | undefined;
  /** e.g. "Required for R2+ actions". */
  humanGate?: string | undefined;
  analysis?: AnalysisView | undefined;
  trust?: TrustEnvelope | undefined;
  timeline: TimelineEntry[];
  approval?: ApprovalRequest | undefined;
  slack?: SlackLink | undefined;
  createdAt: string;
  updatedAt: string;
}

export type ChangeListener = (incident: Incident) => void;

export interface IncidentMeta {
  severity?: IncidentSeverity | undefined;
  service?: string | undefined;
  source?: IncidentSource | undefined;
  mode?: string | undefined;
  humanGate?: string | undefined;
}

export interface CreateIncidentInput {
  id: string;
  scene: number;
  sceneTitle: string;
  subject: string;
  at: string;
  meta?: IncidentMeta | undefined;
}

/**
 * Holds every incident of the current demo session and notifies listeners
 * (the SSE fan-out, and any test) on each change. All timestamps are passed
 * in by the caller so the store never reads a wall clock — that keeps the
 * scenario engine deterministic and the store trivially testable.
 */
export class IncidentStore {
  private readonly incidents = new Map<string, Incident>();
  private readonly listeners = new Set<ChangeListener>();

  /** Subscribe to per-incident changes. Returns an unsubscribe function. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(): Incident[] {
    return [...this.incidents.values()];
  }

  get(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  create(input: CreateIncidentInput): Incident {
    if (this.incidents.has(input.id)) {
      throw new Error(`Incident ${input.id} already exists`);
    }
    const incident: Incident = {
      id: input.id,
      scene: input.scene,
      sceneTitle: input.sceneTitle,
      subject: input.subject,
      lane: "RECEIVED",
      status: "RUNNING",
      severity: input.meta?.severity,
      service: input.meta?.service,
      source: input.meta?.source,
      mode: input.meta?.mode,
      humanGate: input.meta?.humanGate,
      timeline: [],
      createdAt: input.at,
      updatedAt: input.at,
    };
    this.incidents.set(incident.id, incident);
    this.publish(incident);
    return incident;
  }

  /**
   * Applies a partial update, appends nothing on its own, bumps
   * updatedAt, and fans the change out to listeners. Unknown ids throw —
   * a mutation against a missing incident is always a programming error.
   */
  private mutate(id: string, at: string, apply: (incident: Incident) => void): Incident {
    const incident = this.incidents.get(id);
    if (!incident) {
      throw new Error(`No incident ${id}`);
    }
    apply(incident);
    incident.updatedAt = at;
    this.publish(incident);
    return incident;
  }

  /** Appends a timeline entry, auto-numbering seq from the current length. */
  append(id: string, at: string, entry: Omit<TimelineEntry, "seq" | "at">): Incident {
    return this.mutate(id, at, (incident) => {
      incident.timeline.push({ seq: incident.timeline.length + 1, at, ...entry });
    });
  }

  /** Moves an incident to a new lane (and appends nothing). */
  setLane(id: string, at: string, lane: Lane): Incident {
    return this.mutate(id, at, (incident) => {
      incident.lane = lane;
    });
  }

  setStatus(id: string, at: string, status: IncidentStatus): Incident {
    return this.mutate(id, at, (incident) => {
      incident.status = status;
    });
  }

  setApproval(id: string, at: string, approval: ApprovalRequest): Incident {
    return this.mutate(id, at, (incident) => {
      incident.approval = approval;
    });
  }

  /** Sets the current-analysis view (the "what's happening now" card). */
  setAnalysis(id: string, at: string, analysis: AnalysisView): Incident {
    return this.mutate(id, at, (incident) => {
      incident.analysis = analysis;
    });
  }

  /** Merges fields into the trust envelope, so the pipeline can fill it incrementally. */
  setTrust(id: string, at: string, patch: TrustEnvelope): Incident {
    return this.mutate(id, at, (incident) => {
      incident.trust = { ...incident.trust, ...patch };
    });
  }

  /**
   * Records the outcome of an approval decision on the incident's approval
   * request. Throws if there is no pending approval — a decision can only
   * land on an incident that actually asked for one.
   */
  recordDecision(
    id: string,
    at: string,
    decision: "APPROVED" | "REJECTED",
    decidedBy: string,
    decidedVia: DecisionChannel,
  ): Incident {
    return this.mutate(id, at, (incident) => {
      if (!incident.approval) {
        throw new Error(`Incident ${id} has no pending approval`);
      }
      incident.approval = { ...incident.approval, decision, decidedBy, decidedVia, decidedAt: at };
    });
  }

  setSlack(id: string, at: string, slack: SlackLink): Incident {
    return this.mutate(id, at, (incident) => {
      incident.slack = slack;
    });
  }

  private publish(incident: Incident): void {
    for (const listener of this.listeners) {
      listener(incident);
    }
  }
}
