import { ActionDefinitionSchema, type ActionDefinition } from "@aop/contracts";

/**
 * ActionRegistry — spec §13's registry mechanics (story C-02: "registry
 * mechanics only" — the full ActionConnector interface + connector
 * invocation lands in D-01; the three-class compensation validation at
 * registration lands in D-04).
 *
 * RULE 8 / this story's second acceptance criterion: this file contains
 * ZERO conditional logic keyed on action kind, `executor_connector_ref`
 * value, or any other action-kind signal. CONTEXT.md is explicit that
 * registered actions span two kinds — operational actions against
 * production systems, and engineering-change actions whose
 * `executor_connector_ref` invokes the Build loop — "governed
 * identically." A registry that special-cased either kind would violate
 * that at the one place every action, of either kind, has to pass
 * through to be found at all.
 */
export interface ActionRegistry {
  register(action: ActionDefinition): void;
  /** Lookup by the full key (F-07: tenant_id + action_ref + version) — never by action_ref alone. */
  lookup(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined;
  /** Same lookup, but returns undefined for a disabled action — the common case for execution-time resolution. */
  lookupActive(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined;
}

function key(tenantId: string, actionRef: string, version: string): string {
  return `${tenantId}::${actionRef}::${version}`;
}

export class InMemoryActionRegistry implements ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();

  /**
   * Every action is re-run through ActionDefinitionSchema.parse() here —
   * story D-04's first acceptance criterion ("the three-class distinction
   * present and validated at registration," ADR-001/F-14). The schema's
   * own `.refine()` already encodes the reversible/compensation_class
   * invariant; parsing it here, at the one choke point every action (of
   * either kind, per RULE 8 above) must pass through to become findable
   * at all, is what makes that invariant actually enforced rather than
   * merely expressible. A caller passing an inconsistent pair — even one
   * that structurally satisfies the ActionDefinition TypeScript type,
   * since the type alone can't encode a cross-field refinement — gets a
   * thrown ZodError instead of a silently-registered, ungoverned action.
   */
  register(action: ActionDefinition): void {
    const validated = ActionDefinitionSchema.parse(action);
    this.actions.set(key(validated.tenant_id, validated.action_id, validated.version), validated);
  }

  lookup(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined {
    return this.actions.get(key(tenantId, actionRef, version));
  }

  lookupActive(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined {
    const action = this.lookup(tenantId, actionRef, version);
    return action?.status === "active" ? action : undefined;
  }
}
