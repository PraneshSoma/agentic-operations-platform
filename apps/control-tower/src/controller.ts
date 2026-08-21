/**
 * Controller — the orchestration seam between the HTTP/Slack surfaces and
 * the scenario engine. It owns incident-id allocation, turning a scenario
 * key into a running incident, and routing an approval decision to the
 * parked pipeline from whichever surface it arrived on.
 *
 * The engine itself is injected (`run`), so this seam is fully unit-testable
 * with a fake runner: we assert an incident is created and the runner is
 * invoked with the right context, and that a decision reaches the registry,
 * without spinning up the real pipeline or Slack. The server wires the real
 * runner (build a Presenter, call runScenario) in one place.
 */
import type { DecisionChannel, DecisionRegistry } from "./decision-registry.js";
import type { IncidentSeverity, IncidentSource, IncidentStore } from "./incident-store.js";
import { scenarioByKey, scenarioByScene, type Scenario } from "./scenarios.js";

export interface TriggerContext {
  scenario: Scenario;
  incidentId: string;
  subject: string;
  /** Set when the trigger came from Slack, so the engine threads there. */
  slackChannel?: string | undefined;
  slackThreadTs?: string | undefined;
}

export interface TriggerInput {
  /** Scenario key (preferred) or scene number. Defaults to the happy path. */
  key?: string | undefined;
  scene?: number | undefined;
  subject?: string | undefined;
  /** Honest ingress label — SIMULATOR for the sim button, SLACK for a real Slack event, DEMO for the lab. */
  source?: IncidentSource | undefined;
  slackChannel?: string | undefined;
  slackThreadTs?: string | undefined;
}

export type TriggerResult =
  | { ok: true; incidentId: string; scenario: Scenario }
  | { ok: false; reason: "unknown_scenario" };

export interface ControllerDeps {
  store: IncidentStore;
  decisions: DecisionRegistry;
  /** Fire-and-forget engine runner (the server injects the real one). */
  run: (ctx: TriggerContext) => void;
  now: () => Date;
  /** Injectable id generator so tests are deterministic. */
  nextId?: (() => string) | undefined;
}

export class Controller {
  private seq = 0;
  private readonly nextId: () => string;

  constructor(private readonly deps: ControllerDeps) {
    this.nextId = deps.nextId ?? (() => `INC-${1000 + ++this.seq}`);
  }

  private resolveScenario(input: TriggerInput): Scenario | undefined {
    if (input.key !== undefined) {
      return scenarioByKey(input.key);
    }
    if (input.scene !== undefined) {
      return scenarioByScene(input.scene);
    }
    return scenarioByScene(1);
  }

  /**
   * Starts a scenario: allocates an incident, records it in the store, and
   * kicks the (injected) engine runner. Returns synchronously with the new
   * incident id; the pipeline then runs asynchronously and streams updates.
   */
  trigger(input: TriggerInput): TriggerResult {
    const scenario = this.resolveScenario(input);
    if (!scenario) {
      return { ok: false, reason: "unknown_scenario" };
    }
    const incidentId = this.nextId();
    const subject = input.subject?.trim() || defaultSubject(scenario.scene);
    this.deps.store.create({
      id: incidentId,
      scene: scenario.scene,
      sceneTitle: scenario.title,
      subject,
      at: this.deps.now().toISOString(),
      meta: {
        severity: defaultSeverity(scenario.scene),
        service: "checkout-service",
        source: input.source ?? "SIMULATOR",
        mode: "Auto investigation",
        humanGate: "Required for R2+ actions",
      },
    });
    this.deps.run({
      scenario,
      incidentId,
      subject,
      slackChannel: input.slackChannel,
      slackThreadTs: input.slackThreadTs,
    });
    return { ok: true, incidentId, scenario };
  }

  /**
   * Routes an approval decision to the parked pipeline. Returns true if this
   * call is the one that settled it — false if the incident wasn't waiting,
   * or the other surface already decided (idempotent late click).
   */
  decide(incidentId: string, decision: "APPROVED" | "REJECTED", actorId: string, via: DecisionChannel): boolean {
    return this.deps.decisions.resolve(incidentId, { decision, actorId, via });
  }
}

/** The happy-path incident is a P1; the guardrail scenarios ride in as P2. */
export function defaultSeverity(scene: number): IncidentSeverity {
  return scene === 1 ? "P1" : "P2";
}

/** A human-readable default subject when the trigger didn't supply one. */
export function defaultSubject(scene: number): string {
  switch (scene) {
    case 1:
      return "Checkout error rate spike";
    case 2:
      return "Something is wrong with the service";
    case 3:
      return "Post-approval parameter substitution attempt";
    case 4:
      return "Target drifted between approval and execution";
    case 5:
      return "Emergency halt of an in-flight execution";
    case 6:
      return "Runaway investigation over token budget";
    default:
      return "Incident";
  }
}
