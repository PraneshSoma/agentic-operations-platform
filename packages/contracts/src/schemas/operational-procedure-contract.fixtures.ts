import type { OperationalProcedureContract } from "./operational-procedure-contract.js";

/**
 * Three worked OperationalProcedureContract instances for spec §35's
 * schema-validation exercise: "If these require scenario-specific runtime
 * branches, the schema/runtime abstraction is incomplete." Each fixture
 * below encodes one of the three named flows entirely through the generic
 * OPC shape — no field is scenario-specific, no variant of the schema is
 * introduced. Consumed by opc-scenarios.test.ts (story A-04).
 */

/** OPC A — Data Reconciliation (spec §35). */
export const OPC_A_DATA_RECONCILIATION: OperationalProcedureContract = {
  opc_id: "opc_data_reconciliation",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Data Reconciliation",
  status: "published",

  match: {
    categories: ["data-reconciliation"],
    applications: ["billing-service"],
    severities: ["P3"],
    semantic_description: "Application state and runtime state have diverged and need reconciliation.",
  },

  required_context: [
    {
      context_type: "application",
      connector_ref: "billing-app-connector",
      operation: "get_application_state",
      required: true,
      timeout_ms: 5000,
    },
    {
      context_type: "runtime",
      connector_ref: "billing-db-connector",
      operation: "get_runtime_state",
      required: true,
      timeout_ms: 5000,
    },
  ],

  investigation: {
    objective: "Compare application state against runtime state and diagnose the divergence.",
    required_checks: ["query_application_state", "query_runtime_state", "compare_state"],
    max_hypotheses: 3,
  },

  actions: {
    allowed_action_refs: ["reconcile_billing_state"],
  },

  verification: {
    checks: [
      {
        name: "parity_check",
        connector_ref: "billing-db-connector",
        operation: "query_state",
        success_condition: "application_state == runtime_state",
      },
    ],
  },

  escalation: {
    conditions: [{ type: "reconciliation_failed_after_retry", threshold: 1 }],
  },

  rollback: {
    required_for_risk_levels: ["R2", "R3"],
    action_ref: "revert_reconciliation",
  },

  timeout: {
    investigation_minutes: 15,
    approval_minutes: 30,
    execution_minutes: 10,
  },

  budget: {
    max_investigation_tokens: 50_000,
    max_planning_tokens: 20_000,
    max_tool_calls: 20,
    max_wall_clock_minutes: 60,
    on_exceeded: "ESCALATE",
  },
};

/** OPC B — Production Error Spike (spec §35). */
export const OPC_B_PRODUCTION_ERROR_SPIKE: OperationalProcedureContract = {
  opc_id: "opc_production_error_spike",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Production Error Spike",
  status: "published",

  match: {
    categories: ["error-spike"],
    applications: ["checkout-service"],
    severities: ["P1", "P2"],
    semantic_description: "Error rate for a production service has spiked above baseline.",
  },

  required_context: [
    {
      context_type: "runtime",
      connector_ref: "logs-connector",
      operation: "query_recent_errors",
      required: true,
      timeout_ms: 5000,
    },
    {
      context_type: "runtime",
      connector_ref: "metrics-connector",
      operation: "query_error_rate",
      required: true,
      timeout_ms: 5000,
    },
  ],

  investigation: {
    objective: "Isolate the failing service/dependency and select a registered remediation.",
    required_checks: ["query_logs", "query_metrics", "isolate_service"],
    max_hypotheses: 5,
  },

  actions: {
    allowed_action_refs: ["restart_service", "rollback_deployment"],
  },

  verification: {
    checks: [
      {
        name: "health_check",
        connector_ref: "k8s-connector",
        operation: "check_health",
        success_condition: "error_rate < baseline",
      },
    ],
  },

  escalation: {
    conditions: [{ type: "error_rate_not_recovered", threshold: 0.05 }],
  },

  rollback: {
    required_for_risk_levels: ["R2", "R3"],
    action_ref: "rollback_deployment",
  },

  timeout: {
    investigation_minutes: 10,
    approval_minutes: 15,
    execution_minutes: 5,
  },

  budget: {
    max_investigation_tokens: 40_000,
    max_planning_tokens: 15_000,
    max_tool_calls: 15,
    max_wall_clock_minutes: 30,
    on_exceeded: "ESCALATE",
  },
};

/** OPC C — Access / Entitlement Issue (spec §35). */
export const OPC_C_ACCESS_ENTITLEMENT_ISSUE: OperationalProcedureContract = {
  opc_id: "opc_access_entitlement_issue",
  version: "1.0.0",
  tenant_id: "tenant_1",
  name: "Access / Entitlement Issue",
  status: "published",

  match: {
    categories: ["access-entitlement"],
    applications: ["internal-tools"],
    severities: ["P3", "P4"],
    semantic_description: "A user is reporting missing or incorrect access/entitlements.",
  },

  required_context: [
    {
      context_type: "application",
      connector_ref: "iam-connector",
      operation: "get_entitlement_state",
      required: true,
      timeout_ms: 5000,
    },
  ],

  investigation: {
    objective: "Diagnose missing or incorrect access against the expected entitlement policy.",
    required_checks: ["retrieve_entitlement_state", "diagnose_access_gap"],
    max_hypotheses: 3,
  },

  actions: {
    allowed_action_refs: ["grant_entitlement", "revoke_entitlement"],
  },

  verification: {
    checks: [
      {
        name: "access_state_check",
        connector_ref: "iam-connector",
        operation: "query_entitlements",
        success_condition: "entitlement_matches_request",
      },
    ],
  },

  escalation: {
    conditions: [{ type: "requires_manual_review", threshold: true }],
  },

  rollback: {
    required_for_risk_levels: ["R2", "R3"],
    action_ref: "revoke_entitlement",
  },

  timeout: {
    investigation_minutes: 10,
    approval_minutes: 60,
    execution_minutes: 5,
  },

  budget: {
    max_investigation_tokens: 30_000,
    max_planning_tokens: 10_000,
    max_tool_calls: 10,
    max_wall_clock_minutes: 90,
    on_exceeded: "ESCALATE",
  },
};
