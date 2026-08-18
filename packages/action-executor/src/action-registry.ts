import type { ActionDefinition } from "@aop/contracts";

/**
 * ActionRegistry — spec §13's registry mechanics (story C-02: "registry
 * mechanics only" — the full ActionConnector interface + connector
 * invocation lands in D-01).
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

  register(action: ActionDefinition): void {
    this.actions.set(key(action.tenant_id, action.action_id, action.version), action);
  }

  lookup(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined {
    return this.actions.get(key(tenantId, actionRef, version));
  }

  lookupActive(tenantId: string, actionRef: string, version: string): ActionDefinition | undefined {
    const action = this.lookup(tenantId, actionRef, version);
    return action?.status === "active" ? action : undefined;
  }
}
