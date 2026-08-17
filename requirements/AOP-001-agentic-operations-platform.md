> **Loop status:** this is the raw Phase-1 Discovery input for initiative
> `AOP-001` — the full implementation spec as supplied, unedited below the rule.
> It has **not** yet been run through Discovery → Requirements → ADR → LLD →
> Story Gen. Per `README.md`, run `/run-pipeline req=AOP-001` to produce
> `pipeline/discovery_brief.*`, `pipeline/requirements.md`, `pipeline/adr/*`,
> `pipeline/lld/*`, and the real `pipeline/story_queue.json` from it — the
> illustrative queue currently in `loop/agents/supervisor.md` is a placeholder
> derived from this document's own §38, not a substitute for that run.

---

# Agentic Operations Platform — Implementation Specification v0.2

**Status:** Merged implementation baseline — supersedes the standalone v0.1 LLD and the v0.2 hardening addendum. This is the single document an engineer or coding agent should build against.
**Scope:** MVP / Tenant #1 with multi-tenant-safe contracts
**Primary objective:** Execute one real operational ticket end-to-end using config-driven Operational Procedure Contracts (OPCs), context assembly, governed actions, evidence capture, and human approval gates.
**Non-goal for v0.2:** Full enterprise context fabric, business context, source-code/ADR correlation, autonomous approval-threshold relaxation, `OperationalWorkUnit` as a distinct abstraction, a standalone Evidence Graph store, a separate Autonomy Graduation Engine.

## Merge note

This document folds three things into one baseline:

1. The original v0.1 LLD (system context, contracts, components, sections 1–40).
2. The v0.2 hardening addendum — identity delegation, kill switch, drift/preflight checks, context staleness, token budgets, deterministic OPC-match guardrail, minimal Change Context — inserted at the section where each extends existing v0.1 design, marked with letter-suffixed section numbers (e.g. `7A`) so original section numbers stay stable.
3. Three additional refinements made while merging: `SOPDefinition` is renamed to `OperationalProcedureContract` (OPC) throughout, since the object already governs evidence requirements, permitted actions, verification, escalation, and budget — not just a procedure description; `Evidence` gains optional relationship fields (`supports`, `contradicts`, `derived_from`, `supersedes`) so future precedent analysis has real semantics without standing up a graph store; and the Autonomy Ladder (§17.1) is documented as a product/dashboard representation of the existing policy model, with **L3 (human-approved execution) as the v0.2 ceiling** — L4/L5 remain roadmap states, not new engineering.

Two things considered during this merge were deliberately **not** added: `OperationalWorkUnit` as a new abstraction (`IncomingRequest` is adequate until a genuine many-to-one or one-to-many work-item pattern appears) and a standalone Evidence Graph technology (the relationship fields above are sufficient until real precedent volume justifies graph traversal).

---

## 1. Design Principles

### 1.1 Config-driven, not scenario-driven
No tenant- or application-specific logic is embedded in the runtime.

The runtime receives:

- an `IncomingRequest`
- a matched OPC definition
- registered context connectors
- registered actions
- tenant policy
- historical evidence

The runtime does **not** know what "Customer Profile", "hierarchy mismatch", "THD", "ServiceNow", "Slack", or any other customer-specific term means.

### 1.2 LLM proposes; runtime authorizes
The agent may:

- classify
- investigate
- form hypotheses
- generate a plan
- recommend an action
- summarize evidence

The agent may **not** directly mutate production systems.

All mutations flow through:

`ProposedAction -> PolicyEngine -> ApprovalGate -> ActionExecutor -> Verification -> EvidenceLedger`

### 1.3 Read and write capabilities are separate
Read-only context access and mutating actions are registered separately.

A tenant may grant broad read access while keeping write authority narrow and governed.

### 1.4 Evidence before autonomy
No autonomy escalation is based on a model self-reported confidence score.

Autonomy decisions must be based on deterministic policy plus historical outcome evidence.

### 1.5 Context is intentionally narrow in v0.1
The MVP supports:

1. **Application Context**
2. **Runtime Context**
3. **Historical Evidence**

Deferred to Phase 2+:

- Engineering Context
- Business Context

This prevents the initial platform from becoming a context-management project before the resolution loop is proven.

---

# 2. MVP System Context

```text
External Trigger
      |
      v
+------------------+
| Trigger Adapter  |
+--------+---------+
         |
         v
 IncomingRequest
         |
         v
+------------------+
| Request Router   |
| + OPC Matcher    |
+--------+---------+
         |
         v
+----------------------------+
| Durable Orchestrator       |
|                            |
| classify                   |
| assemble context           |
| investigate                |
| diagnose                   |
| plan                       |
| request approval           |
| execute                    |
| verify                     |
| close/escalate             |
+------------+---------------+
             |
   +---------+----------+
   |                    |
   v                    v
Context Service      Policy Engine
   |                    |
   v                    v
Connectors         Approval Service
                        |
                        v
                 Action Executor
                        |
                        v
                 Verification
                        |
                        v
                 Evidence Ledger
                        |
                        v
                  Control Tower
```

---

# 3. Component Inventory

## 3.1 Tenant Configuration Service

### Responsibility
Stores versioned tenant-specific configuration.

### Stores

- trigger configurations
- OPC definitions
- context connector registrations
- action registry
- policy definitions
- approval routing
- tenant metadata

### Interface

```http
GET /tenants/{tenantId}/opcs
GET /tenants/{tenantId}/opcs/{opcId}
POST /tenants/{tenantId}/opcs
PUT /tenants/{tenantId}/opcs/{opcId}

GET /tenants/{tenantId}/connectors
POST /tenants/{tenantId}/connectors

GET /tenants/{tenantId}/actions
POST /tenants/{tenantId}/actions

GET /tenants/{tenantId}/policies
```

### Design rules

- every config artifact is versioned
- runtime executions pin the config version used
- published OPC versions are immutable
- updates create a new version
- secrets are references to a secret manager, never stored inline

---

# 4. Core Domain Contracts

## 4.1 IncomingRequest

Normalized representation of any incoming operational work.

```yaml
IncomingRequest:
  request_id: string
  tenant_id: string

  source:
    type: slack | servicenow | pagerduty | email | webhook
    source_id: string
    source_reference: string

  received_at: timestamp

  requester:
    id: string
    display_name: string?
    roles: [string]

  subject: string
  description: string

  labels:
    severity: string?
    application: string?
    environment: string?
    category: string?

  raw_payload_ref: string

  correlation:
    incident_id: string?
    ticket_id: string?
    conversation_id: string?
```

### Rules

- raw trigger payload is preserved separately
- downstream components consume only normalized data
- trigger-specific fields must not leak into orchestration logic

---

## 4.2 OperationalProcedureContract

```yaml
OperationalProcedureContract:
  opc_id: string
  version: string
  tenant_id: string
  name: string
  status: draft | published | retired

  match:
    categories: [string]
    applications: [string]
    severities: [string]
    semantic_description: string?

  required_context:
    - context_type: application | runtime | evidence
      connector_ref: string
      operation: string
      required: boolean
      timeout_ms: integer

  investigation:
    objective: string
    required_checks: [string]
    max_hypotheses: integer

  actions:
    allowed_action_refs: [string]

  verification:
    checks:
      - name: string
        connector_ref: string
        operation: string
        success_condition: string

  escalation:
    conditions:
      - type: string
        threshold: any

  rollback:
    required_for_risk_levels: [R2, R3]
    action_ref: string?

  timeout:
    investigation_minutes: integer
    approval_minutes: integer
    execution_minutes: integer

  budget:
    max_investigation_tokens: integer
    max_planning_tokens: integer
    max_tool_calls: integer
    max_wall_clock_minutes: integer
    on_exceeded: ESCALATE | STOP_AND_SUMMARIZE   # default: ESCALATE
```

### Important
The OPC is declarative.

It describes:

- what evidence is required
- what checks are mandatory
- what actions are allowed
- what verification must occur
- when escalation is mandatory

The OPC must not contain executable arbitrary code in v0.1.

---

## 4.3 ProposedAction

```yaml
ProposedAction:
  proposal_id: string
  request_id: string
  execution_id: string
  tenant_id: string

  action_ref: string
  action_version: string

  reason: string

  parameters:
    key: value

  expected_outcome: string

  risk_assessment:
    requested_risk_class: R0 | R1 | R2 | R3
    blast_radius:
      scope: string
      estimated_entities: integer?
    reversible: boolean

  supporting_evidence_ids: [string]

  generated_by:
    agent: string
    model: string
    prompt_version: string

  created_at: timestamp
```

---

## 4.4 PolicyDecision

```yaml
PolicyDecision:
  decision_id: string
  proposal_id: string

  policy_version: string

  effective_risk_class: R0 | R1 | R2 | R3

  outcome:
    ALLOW |
    REQUIRE_APPROVAL |
    DENY

  approval_route: string?

  reasons:
    - rule_id: string
      explanation: string

  evidence_summary:
    precedent_count: integer
    verified_success_count: integer
    rollback_count: integer
    failure_count: integer

  created_at: timestamp
```

---

## 4.5 ExecutionResult

```yaml
ExecutionResult:
  execution_result_id: string
  proposal_id: string

  action_ref: string
  started_at: timestamp
  completed_at: timestamp

  status:
    SUCCESS |
    FAILED |
    PARTIAL |
    TIMED_OUT

  provider_reference: string?

  output_summary: string

  side_effects:
    entities_changed: integer?
    systems_touched: [string]

  error:
    code: string?
    message: string?

  rollback_available: boolean
```

---

## 4.6 Evidence

```yaml
Evidence:
  evidence_id: string
  tenant_id: string
  request_id: string
  execution_id: string

  type:
    REQUEST |
    CONTEXT |
    OBSERVATION |
    HYPOTHESIS |
    PLAN |
    APPROVAL |
    ACTION_RESULT |
    VERIFICATION |
    ROLLBACK |
    OUTCOME

  source:
    component: string
    connector_ref: string?
    source_reference: string?

  content:
    summary: string
    structured_data: object?

  relationships:
    supports: [evidence_id]?
    contradicts: [evidence_id]?
    derived_from: [evidence_id]?
    supersedes: evidence_id?

  integrity:
    created_at: timestamp
    content_hash: string

  retention_class: string
```

### Note on `relationships`

These fields make the ledger graph-*ready* without standing up graph technology: the append-only relational store (§21) remains the system of record, and `relationships` is queryable via standard joins on `evidence_id`. This is deliberately the minimum needed to later support precedent analysis (`derived_from` chains, `contradicts` for conflicting hypotheses, `supersedes` for corrected records) — a dedicated graph store is not justified until real evidence volume exists to traverse.

---

# 5. Trigger Layer

## 5.1 TriggerSource Interface

```typescript
interface TriggerSource {
  validateConfig(config: TriggerConfig): ValidationResult;

  start(config: TriggerConfig): Promise<void>;

  normalize(rawEvent: unknown): Promise<IncomingRequest>;

  acknowledge(sourceReference: string): Promise<void>;

  reject(
    sourceReference: string,
    reason: string
  ): Promise<void>;
}
```

### Initial adapters

- Slack
- Webhook

### Later adapters

- ServiceNow
- PagerDuty
- Email

### TriggerConfig

```yaml
TriggerConfig:
  trigger_id: string
  tenant_id: string
  type: slack | webhook | servicenow | pagerduty | email

  endpoint_config_ref: string

  filters:
    applications: [string]?
    channels: [string]?
    queues: [string]?

  classification_schema_ref: string
```

---

# 6. Request Router and OPC Matcher

## Responsibility

1. enrich request with basic metadata
2. find candidate OPCs
3. select the best matching OPC
4. create an orchestration execution

### Matching strategy v0.1

```text
Exact deterministic filters
        |
        v
category/application/severity
        |
   multiple candidates?
        |
       yes
        v
semantic matcher
        |
        v
selected OPC
```

### Guardrail
If no OPC meets the minimum match policy:

`ESCALATE_TO_HUMAN`

Do not invent an OPC dynamically.

---

## 6A. Deterministic OPC Matching Guardrail

The semantic fallback above is the one non-deterministic step in an otherwise fully deterministic routing/policy system. It requires an explicit tolerance, not a best-guess selection between close candidates.

```yaml
OPCMatchResult:
  request_id: string
  candidates:
    - opc_id: string
      opc_version: string
      match_score: number
  selected_opc_id: string?
  match_margin: number?             # score(top) - score(second)
  minimum_required_margin: number   # tenant-configured, e.g. 0.15
  outcome: MATCHED | AMBIGUOUS_ESCALATE
```

### Rule

- If the top candidate's margin over the second-best candidate is below `minimum_required_margin`, the outcome is `AMBIGUOUS_ESCALATE` — this extends the existing guardrail ("do not invent an OPC dynamically") to "do not silently pick between two similarly-plausible OPCs either."
- `OPCMatchResult` is written to the Evidence Ledger unconditionally, including all candidates and scores considered, not only the winner — this makes routing decisions auditable and gives tenants the data to tune `minimum_required_margin` over time.

---

# 7. Durable Orchestrator

## Recommended abstraction

A persisted state machine.

LangGraph may implement it, but the LLD should not depend on LangGraph.

### ExecutionState

```yaml
ExecutionState:
  execution_id: string
  tenant_id: string
  request_id: string

  opc_id: string
  opc_version: string

  state:
    RECEIVED |
    OPC_MATCHED |
    CONTEXT_ASSEMBLY |
    INVESTIGATING |
    DIAGNOSED |
    PLANNED |
    WAITING_APPROVAL |
    EXECUTING |
    VERIFYING |
    ROLLING_BACK |
    RESOLVED |
    ESCALATED |
    ESCALATED_HUMAN_OVERRIDE |
    FAILED

  context_package_ref: string?

  proposal_ids: [string]

  current_proposal_id: string?

  retry_count: integer

  budget_consumed:
    investigation_tokens: integer
    planning_tokens: integer
    tool_calls: integer

  created_at: timestamp
  updated_at: timestamp
```

### State transition requirements

Every transition must:

1. persist current state
2. emit an event
3. write an evidence record
4. be idempotent

---

## 7A. Emergency Interruption (Kill Switch)

The state model above gates automation *before* execution (policy, approval, frozen plan) but needs a way to stop something already executing or awaiting a step — required for SRE/incident-response use where an operator needs to halt automation immediately, independent of whether anything has gone wrong yet.

### Endpoints

```http
POST /executions/{execution_id}/halt
POST /tenants/{tenantId}/halt-all
```

```yaml
HaltRequest:
  actor:
    id: string
    role: string          # must be in tenant's required_halt_roles
  scope: single_execution | all_tenant_executions
  reason: string
  created_at: timestamp
```

### Behavior on halt

1. Any pending `ExecutionAuthorization` (§14A) for the target execution(s) is immediately revoked.
2. If the target action connector supports cancellation, cancellation is attempted; the result (cancelled / already-completed / cancel-not-supported) is recorded as evidence — the platform does not assume cancellation succeeded.
3. If the action already completed before the halt was received, the halt does **not** attempt automatic rollback — it transitions state and surfaces the situation for human decision. Rollback remains a separate, explicitly authorized action (§20).
4. State transitions to `ESCALATED_HUMAN_OVERRIDE`.
5. An `Evidence` record (`type: OUTCOME`) and a `PlatformEvent` (`execution.halted`, §22) are written unconditionally, including who triggered it and why.

### Authorization

`required_halt_roles` is tenant-configured (e.g. `senior_oncall`, `platform_owner`). Halting is intentionally easier to trigger than approving a mutation — a false-positive halt costs little; a missed halt during a live incident costs a great deal. `halt-all` is scoped to a single tenant, consistent with §23.

---

## 7B. Token & Cost Governance

Investigation loops over large log/metric volumes have no ceiling without this section — an ambiguous or noisy ticket could otherwise drive unbounded tool calls and token spend.

### Enforcement

- The orchestrator tracks cumulative usage against `ExecutionState.budget_consumed`, checked at each state transition, against the limits declared in the matched OPC's `budget` block (§4.2).
- On exceeding budget: default behavior is `ESCALATE` with `escalation_reason: BUDGET_EXCEEDED`. The platform does not silently truncate an investigation and present a partial diagnosis as complete. `STOP_AND_SUMMARIZE` is available as an explicit tenant opt-in for lower-stakes OPCs where a partial answer is still useful.
- Budget consumption is written to the Evidence Ledger per execution and surfaced via the `agent_token_usage` metric (§29).
- Hitting the ceiling routinely on a given OPC is a signal the OPC or context assembly needs tuning, not that the ceiling should simply be raised.

---

# 8. Context Service

The Context Service is one of the most important MVP components.

Its job is not simply to proxy tool calls.

It assembles a **bounded Context Package** for the investigator.

## 8.1 Context types supported in v0.1

### Application Context

Contains stable operational metadata.

```yaml
ApplicationContext:
  application_id: string
  name: string

  owners: [string]

  environments: [string]

  dependencies:
    upstream: [Dependency]
    downstream: [Dependency]

  apis:
    - name: string
      endpoint_ref: string

  datastores:
    - name: string
      type: string

  messaging:
    - name: string
      type: topic | queue

  slo_refs: [string]

  approved_action_refs: [string]

  change_context:
    last_deployed_version: string?
    last_deployed_at: timestamp?
    recent_change_ids: [string]?      # ticket/PR/commit IDs, opaque references only
    change_owner: string?
```

**On `change_context`:** metadata only — no code diff, no PR content, no ADR text. If a connector can only supply a version + timestamp, that's sufficient; richer sources are optional. Populated via the same read-only Context Connector interface as everything else, typically a thin connector against a deployment/CI system's API — not a new connector class. Used by the Investigator (§11) as one more observation input ("deployment 3h prior to ticket" is evidence, not a conclusion). This is explicitly **not** a step toward full Engineering Context (§36) — no git access, no ADR correlation, no "does runtime behavior contradict intent" reasoning. That remains Phase 2.

### Runtime Context

```yaml
RuntimeContext:
  time_window:
    from: timestamp
    to: timestamp

  logs:
    summaries: [string]
    evidence_refs: [string]

  metrics:
    - metric: string
      current: number
      baseline: number?
      anomaly: boolean

  traces:
    summaries: [string]

  deployment_state:
    version: string?
    deployed_at: timestamp?
```

### Evidence Context

```yaml
HistoricalEvidenceContext:
  similar_cases:
    - prior_request_id: string
      similarity: number
      diagnosis: string
      action_ref: string?
      outcome: string
      rollback: boolean

  aggregate:
    precedent_count: integer
    verified_success_count: integer
    failure_count: integer
    rollback_count: integer
```

---

# 9. Context Package

This is a first-class artifact.

```yaml
ContextPackage:
  context_package_id: string
  tenant_id: string
  request_id: string
  opc_id: string

  assembled_at: timestamp

  application_context: ApplicationContext
  runtime_context: RuntimeContext
  historical_evidence: HistoricalEvidenceContext

  missing_context:
    - source: string
      reason: string
      required: boolean

  provenance:
    - connector_ref: string
      query_ref: string
      retrieved_at: timestamp
```

### Context Package design constraints

- immutable once supplied to a reasoning step
- bounded by token/data policy
- raw logs remain outside the package
- summaries link back to original evidence
- all sources must preserve provenance
- stale context is marked

---

# 10. Context Connector Registry

## Read-only Connector interface

```typescript
interface ContextConnector {
  descriptor(): ConnectorDescriptor;

  validateConfig(config: ConnectorConfig): ValidationResult;

  executeRead(
    operation: string,
    input: Record<string, unknown>,
    executionContext: ConnectorExecutionContext
  ): Promise<ConnectorReadResult>;
}
```

### ConnectorDescriptor

```yaml
ConnectorDescriptor:
  connector_id: string
  tenant_id: string
  type: logs | metrics | database | api | knowledge

  operations:
    - name: string
      input_schema: object
      output_schema: object

  authorization:
    mode: oauth | api_key | service_account | custom
    secret_ref: string

  scopes:
    environments: [string]
    applications: [string]

  staleness:
    max_age_seconds: integer
    on_exceeded: MARK_STALE | REFETCH | FAIL
```

Suggested `max_age_seconds` defaults by context type (tenant-overridable):

| Context type | Suggested default | Rationale |
|---|---|---|
| Runtime Context (logs/metrics/traces) | 60–300 | Operationally meaningless if minutes old during an active incident |
| Application Context (owners, dependencies, SLOs) | days | Changes rarely; expensive to refetch every execution |
| Historical Evidence | hours | Precedent set shifts slowly but should reflect recent outcomes |

`ContextPackage.missing_context` (§9) also carries `stale_context: [{source, age_seconds, max_age_seconds}]` so the investigator and any human reviewer can see explicitly what data was outside tolerance, rather than staleness being an internal-only flag.

### Security
Read connectors cannot expose write operations through the same interface.

---

# 11. Investigator Agent

## Inputs

- `IncomingRequest`
- `OperationalProcedureContract`
- `ContextPackage`

## Outputs

```yaml
InvestigationResult:
  observations:
    - id: string
      statement: string
      evidence_ids: [string]

  hypotheses:
    - id: string
      description: string
      supporting_evidence_ids: [string]
      contradicting_evidence_ids: [string]
      status: supported | rejected | unresolved

  diagnosis:
    summary: string
    evidence_ids: [string]

  missing_information: [string]

  recommended_next_step:
    PLAN |
    MORE_CONTEXT |
    ESCALATE
```

### Rule
The agent may not invent connector results.

Every factual operational claim must trace to evidence.

---

# 12. Planner Agent

## Input

- InvestigationResult
- OperationalProcedureContract
- Action Registry
- Tenant Policy

## Output

```yaml
ResolutionPlan:
  plan_id: string

  diagnosis_ref: string

  steps:
    - step_id: string
      type: READ | ACTION | VERIFY
      description: string
      action_ref: string?
      parameters: object?

  expected_outcome: string

  rollback_strategy: string?

  unresolved_risks: [string]
```

### Frozen Plan Rule

Once a human approves a plan:

- approved mutation steps are frozen
- the executor cannot add or substitute actions
- changed parameters require re-approval
- additional read-only verification may be permitted if policy allows

---

# 13. Action Registry

```yaml
ActionDefinition:
  action_id: string
  version: string
  tenant_id: string

  name: string
  description: string

  executor_connector_ref: string
  operation: string

  input_schema: object

  default_risk_class: R0 | R1 | R2 | R3

  blast_radius:
    scope: entity | service | environment | multi_service

  reversible: boolean
  rollback_action_ref: string?

  environment_constraints:
    allowed: [dev, test, stage, prod]

  policy_tags: [string]

  status: active | disabled
```

---

# 14. Action Executor

## Write interface

```typescript
interface ActionConnector {
  descriptor(): ActionConnectorDescriptor;

  validateAction(
    action: ActionDefinition,
    parameters: Record<string, unknown>
  ): ValidationResult;

  preflight(
    action: ActionDefinition,
    parameters: Record<string, unknown>,
    expectedPreconditions: PreconditionSet
  ): Promise<PreflightResult>;

  execute(
    action: ActionDefinition,
    parameters: Record<string, unknown>,
    authorization: ExecutionAuthorization
  ): Promise<ExecutionResult>;

  rollback?(
    executionResult: ExecutionResult,
    authorization: ExecutionAuthorization
  ): Promise<ExecutionResult>;
}
```

### Executor requirements

- receives a signed `ExecutionAuthorization`
- rejects expired approval tokens
- validates parameters against schema
- runs `preflight()` (§14B) immediately before `execute()`, every time
- supports idempotency key
- emits before/after evidence
- never accepts a free-form model instruction

---

## 14A. Execution Identity & Delegation

A platform service account executing all mutations satisfies "the system did it" but not "who authorized it" — enterprise audit and compliance scope generally requires mutations to be traceable to an accountable human identity, not just a platform identity.

```yaml
ExecutionAuthorization:
  authorization_id: string
  proposal_id: string
  policy_decision_id: string

  identity:
    mode: SERVICE_ACCOUNT | ON_BEHALF_OF
    acting_as:
      id: string
      type: platform_service_account | human
    approver_ref: string?          # required when mode = ON_BEHALF_OF
    requester_ref: string?

  delegation:
    token_type: obo | scoped_short_lived | none
    token_ref: string?             # reference into secret manager, never inline
    scopes: [string]
    issued_at: timestamp
    expires_at: timestamp

  signed_plan_hash: string
  issued_by: string
  created_at: timestamp
```

### Rules

- For `risk_class in [R2, R3]`, tenant policy MAY require `mode: ON_BEHALF_OF`. Default posture: **required** unless a tenant explicitly opts out — the safer default holds without configuration.
- For `risk_class in [R0, R1]`, `SERVICE_ACCOUNT` mode is permitted by default.
- `approver_ref` in OBO mode must match the actor who issued the `ApprovalDecision` (§18) for the same `proposal_id` — the executor rejects mismatched identities.
- Delegated tokens are short-lived and scoped to the single action + parameters in the frozen plan, not general-purpose credentials.
- The `ActionConnector.execute()` call receives the resolved `ExecutionAuthorization` and must reject execution if `identity.mode` does not satisfy the action's `environment_constraints`/`policy_tags` requirements (§13).

---

## 14B. Pre-Execution Drift Check (Preflight)

Between context assembly, human approval, and actual execution, real time passes — production state can change (a concurrent deploy, another operator's fix, a config change) underneath an already-approved plan. This closes that gap without weakening the Frozen Plan Rule (§12): it adds a check *in front of* execution rather than allowing the executor to reinterpret the plan.

```yaml
PreconditionSet:
  # a small set of fields from the ContextPackage / plan that must still hold
  checks:
    - field_ref: string        # e.g. "runtime_context.deployment_state.version"
      expected_value: any
      tolerance: exact | within_range | unchanged_since

PreflightResult:
  status: MATCH | DRIFTED | UNKNOWN
  drifted_fields:
    - field_ref: string
      expected: any
      observed: any
```

### Rule

- `DRIFTED` → the executor does **not** proceed. The execution transitions back to `WAITING_APPROVAL` with a re-plan flag, or to `ESCALATED`, per tenant policy — the same "changed parameters require re-approval" rule from §12's Frozen Plan Rule now explicitly covers drift discovered by the system, not only drift the agent happens to notice.
- `UNKNOWN` (preflight itself failed, e.g. connector timeout) is treated as required context missing → escalate (§30), not treated as an implicit pass.
- Preflight checks are read-only by construction — they use the same read connector interface as context assembly (§10), never the write path, preserving the read/write separation invariant.

---

# 15. Risk Classification

## R0
Read-only or no-impact operation.

Examples:

- inspect logs
- query metrics
- retrieve entity state

## R1
Narrow reversible mutation with known blast radius.

## R2
Production mutation with meaningful customer/service impact.

## R3
High-impact, multi-system, irreversible, security-sensitive, or data-destructive operation.

### Important
Agent-suggested risk is advisory.

The Policy Engine computes the effective risk from:

- registered action risk
- environment
- requested parameters
- blast radius
- policy tags
- evidence history

---

# 16. Policy Engine

The policy engine must be deterministic.

Example:

```yaml
PolicyRule:
  rule_id: PROD_R2_APPROVAL
  when:
    environment: prod
    risk_class_in: [R2, R3]
  decision: REQUIRE_APPROVAL
  approval_route: senior_oncall
```

### Policy evaluation

```text
ProposedAction
      |
      v
Resolve ActionDefinition
      |
      v
Calculate Effective Risk
      |
      v
Evaluate Tenant Rules
      |
      +--> DENY
      |
      +--> REQUIRE_APPROVAL
      |
      +--> ALLOW
```

---

# 17. Autonomy Graduation Policy

This is explicitly defined in v0.1 even though automated graduation is disabled.

## v0.1 Rule
Historical evidence may be **displayed** to policy reviewers, but cannot automatically lower the approval requirement.

### Suggested future graduation criteria

A tenant may configure:

```yaml
AutonomyGraduationPolicy:
  enabled: false

  minimum_precedents: 30
  minimum_verified_success_rate: 0.98
  maximum_rollback_rate: 0.01
  minimum_observation_days: 30

  allowed_risk_classes:
    - R1

  required_approver_roles:
    - platform_owner
    - security_owner

  revalidation:
    every_days: 30

  regression:
    on_failure: REQUIRE_APPROVAL
    on_rollback: REQUIRE_APPROVAL
```

### Design principle

The platform must never interpret:

`model confidence = 0.87`

as authority to increase autonomy.

Future autonomy is based on:

- number of comparable executions
- verified outcome rate
- rollback rate
- failure rate
- time window
- explicit tenant governance approval

---

## 17.1 Autonomy Ladder (Product / Dashboard Representation)

This is a naming and presentation layer over the mechanics already defined above and in §16 (risk classes R0–R3) — it introduces no new engine, service, or contract. Its purpose is to give the Control Tower (§27–28) a single, explainable dial to show leadership and reviewers, rather than leaving autonomy implicit in policy YAML.

```text
L0  Observe                  — AI collects context only
L1  Investigate               — AI diagnoses
L2  Recommend                 — AI generates resolution plan
L3  Human-approved execution  — AI executes an approved frozen plan   ← v0.2 ceiling
L4  Policy-autonomous         — known procedure executes automatically
L5  Evidence-graduated        — repeated evidence-backed patterns graduate
```

### Rule for v0.2

**L3 is the ceiling.** No OPC, tenant, or action reaches L4/L5 in this version — `AutonomyGraduationPolicy.enabled` stays `false` everywhere (§17). L4/L5 are roadmap states: when `AutonomyGraduationPolicy` is explicitly enabled and an action meets the criteria above, it would present as L4 or L5 on this ladder, but building the L4/L5 *execution* path is out of scope until the L0–L3 loop has run against real tickets.

Per-OPC ladder position is derived, not stored — it's a read view over `AutonomyGraduationPolicy.enabled`, `PolicyDecision.evidence_summary` (§4.4), and recent `ExecutionResult`/`VerificationResult` history, surfaced on the OPC Performance View (§28).

---

# 18. Approval Service

## ApprovalRequest

```yaml
ApprovalRequest:
  approval_id: string
  tenant_id: string
  request_id: string
  plan_id: string
  proposal_id: string

  approver_route: string

  summary:
    diagnosis: string
    proposed_action: string
    expected_outcome: string
    blast_radius: string
    rollback: string

  supporting_evidence_ids: [string]

  expires_at: timestamp
```

## ApprovalDecision

```yaml
ApprovalDecision:
  approval_id: string

  decision:
    APPROVED |
    REJECTED |
    REQUEST_CHANGES |
    EXPIRED

  actor:
    id: string
    role: string

  comment: string?

  decided_at: timestamp
```

### Slack v0.1
Slack is one approval UI, not the approval system.

Slack buttons call Approval Service APIs.

---

# 19. Verification Engine

Execution success does not equal resolution success.

Verification is mandatory for mutating operations.

```yaml
VerificationResult:
  verification_id: string
  execution_result_id: string

  checks:
    - name: string
      status: PASS | FAIL | UNKNOWN
      evidence_ids: [string]

  overall:
    VERIFIED |
    FAILED |
    INCONCLUSIVE

  recommended_next_step:
    CLOSE |
    ROLLBACK |
    ESCALATE
```

---

# 20. Rollback Manager

Rollback is policy-driven.

```text
Verification Failed
       |
       v
Is action reversible?
       |
   +---+---+
   |       |
  yes      no
   |       |
   v       v
Policy    Escalate
check
   |
   +--> automatic rollback allowed
   |
   +--> rollback approval required
```

Rollback is an action and therefore follows the same authorization model as forward execution.

---

# 21. Evidence Ledger

## Storage model

Recommended logical tables / collections:

```text
requests
executions
state_transitions
context_packages
evidence_items
investigations
plans
proposed_actions
policy_decisions
approvals
action_executions
verification_results
rollbacks
final_outcomes
```

### Mandatory properties

Every record includes:

- tenant_id
- request_id
- execution_id where applicable
- timestamp
- schema_version

### Integrity

Evidence records should be append-only for v0.1.

Corrections create a new record referencing the superseded evidence.

---

# 22. Event Model

Recommended events:

```text
request.received
request.normalized
opc.matched
context.assembly.started
context.assembly.completed
investigation.completed
diagnosis.completed
plan.created
action.proposed
policy.evaluated
approval.requested
approval.decided
execution.started
execution.completed
verification.completed
rollback.started
rollback.completed
request.resolved
request.escalated
```

Each event:

```yaml
PlatformEvent:
  event_id: string
  event_type: string
  tenant_id: string
  request_id: string
  execution_id: string
  occurred_at: timestamp
  payload_ref: string
  correlation_id: string
```

---

# 23. Multi-Tenant Isolation

Tenant isolation applies at:

1. configuration
2. connector credentials
3. context queries
4. evidence storage
5. vector/search indexes
6. event streams
7. dashboards
8. action execution

### Required invariant

Every storage access must include `tenant_id`.

### Recommended MVP deployment
Start with logically multi-tenant contracts but support:

`single-tenant-per-deployment`

for the first enterprise prototype if required.

This reduces initial operational risk while preserving the data model for eventual SaaS.

---

# 24. Secrets and Authentication

Secrets must not enter agent context.

Flow:

```text
Agent requests connector operation
        |
        v
Connector Service
        |
        v
Resolve secret reference
        |
        v
Secret Manager
        |
        v
Perform call
```

The LLM sees:

- connector name
- operation schema
- sanitized result

The LLM never sees:

- API key
- OAuth refresh token
- database password
- private certificate

---

# 25. Agent Prompt Architecture

System prompts remain domain-neutral.

## Investigator prompt inputs

```text
ROLE:
Investigate an operational request using only supplied context.

INPUT:
- IncomingRequest
- OPC
- ContextPackage

RULES:
- cite evidence IDs for factual assertions
- distinguish observation from hypothesis
- do not propose actions outside OPC
- identify missing evidence
- escalate when evidence is insufficient
```

## Planner prompt inputs

```text
ROLE:
Create a resolution plan from an approved diagnosis.

INPUT:
- OPC
- diagnosis
- ActionDefinitions
- policy constraints

RULES:
- only registered actions
- output structured plan
- identify risk
- include verification
- include rollback where required
```

---

# 26. Confidence Model

Avoid one ambiguous `confidence: 0.87`.

v0.1 separates confidence dimensions.

```yaml
ReasoningAssessment:
  evidence_coverage:
    value: HIGH | MEDIUM | LOW

  precedent_strength:
    matching_cases: integer
    verified_successes: integer

  diagnosis_status:
    CONFIRMED |
    PROBABLE |
    INCONCLUSIVE

  unresolved_questions: [string]
```

If a numeric score is later introduced, it must be empirically calibrated against historical outcomes.

---

# 27. Control Tower Data Model

The dashboard consumes operational events and evidence; it does not query production systems directly.

## 27.1 Leadership Metrics

### Workload

- incoming requests
- requests by application
- requests by category
- severity distribution
- aging
- backlog

### Resolution

- MTTA
- MTTR
- resolved by AI-assisted path
- resolved with human approval
- human-only escalations
- rollback count

### Automation

- OPC coverage
- plan acceptance rate
- successful execution rate
- verification pass rate
- escalation rate

### Capacity

```text
estimated manual effort
-
measured assisted effort
=
estimated engineering hours returned
```

Do not present financial savings until the calculation model is explicitly defined.

### Governance

- actions by risk class
- approvals requested
- approvals rejected
- policy denials
- expired approvals
- rollback rate
- evidence completeness

---

# 28. Dashboard Views

## Leadership Overview

```text
Ticket Volume
MTTR
Automation Coverage
Engineering Hours Returned
Risk Distribution
Top Applications
Top Repeat Issues
```

## Operations View

```text
Open Requests
AI Investigation Status
Waiting Approval
Executing
Verification Failures
Escalations
```

## Governance View

```text
R0 / R1 / R2 / R3
Policy Decisions
Approval History
Execution History
Rollback History
Evidence Completeness
```

## OPC Performance View

```text
OPC
executions
success %
approval %
rollback %
median MTTR
human intervention %
```

---

# 29. Observability of the Platform

The automation platform itself must be observable.

## Metrics

```text
orchestration_duration_seconds
context_connector_latency
context_connector_error_rate
agent_call_latency
agent_token_usage
policy_evaluation_count
approval_wait_seconds
action_execution_seconds
verification_failure_rate
rollback_rate
```

## Tracing

One distributed trace per `execution_id`.

Suggested spans:

```text
trigger.normalize
opc.match
context.assemble
context.connector.<name>
agent.investigate
agent.plan
policy.evaluate
approval.wait
action.execute
verification.execute
rollback.execute
```

---

# 30. Failure Handling

## Connector unavailable

If required context:

`ESCALATE`

If optional context:

continue with explicit `missing_context`.

## LLM unavailable

Retry according to platform policy.

If retry exhausted:

`ESCALATE`

## Approval timeout

`EXPIRED -> ESCALATE`

## Action timeout

Do not blindly retry mutations.

Check action idempotency and provider status first.

## Verification inconclusive

`ESCALATE`

Do not mark ticket resolved.

---

# 31. Idempotency

Required for:

- trigger ingestion
- execution creation
- approval callbacks
- action execution
- rollback

Recommended idempotency key:

```text
tenant_id
+
request_id
+
plan_id
+
step_id
+
action_version
```

---

# 32. Initial Persistence Model

Suggested relational core:

```sql
tenant
opc_definition
connector_definition
action_definition
policy_definition

incoming_request
execution
execution_state_history

context_package
evidence

investigation
resolution_plan
proposed_action

policy_decision
approval

action_execution
verification
rollback
outcome
```

Vector search may be added only for historical evidence retrieval.

Do not use vector storage as the system of record.

---

# 33. v0.1 End-to-End Flow

```text
1. Slack/Webhook event
2. Trigger adapter creates IncomingRequest
3. Router matches OPC
4. Orchestrator starts durable execution
5. Context Service builds:
      Application Context
      Runtime Context
      Historical Evidence
6. Investigator produces evidence-linked diagnosis
7. Planner creates frozen ResolutionPlan
8. ProposedAction created
9. Policy Engine evaluates
10. Human approval if required
11. Action Executor performs registered action
12. Verification Engine validates expected outcome
13. Rollback or escalation if verification fails
14. Evidence Ledger records entire chain
15. Trigger adapter posts final status
16. Control Tower receives derived telemetry
```

---

# 34. Prototype Acceptance Criteria

The prototype is successful only if all of the following are true:

- no scenario-specific execution code exists
- one OPC can be changed without rebuilding runtime
- a second unrelated OPC can run config-only
- all facts in diagnosis trace to evidence
- agent cannot directly execute write connector
- action execution requires PolicyDecision
- mutation plan becomes immutable after approval
- all production mutations are verified
- every significant state transition is auditable
- tenant ID is enforced throughout persistence
- control tower reconstructs an execution from evidence
- same runtime handles at least three OPCs
- an in-flight execution can be halted (§7A) and transitions to `ESCALATED_HUMAN_OVERRIDE` with an auditable reason
- a deliberately staged state change between approval and execution is caught by the preflight check (§14B) and blocks execution rather than proceeding silently
- an execution that exceeds its configured token/tool-call budget (§7B) escalates rather than returning a truncated result presented as complete
- an intentionally ambiguous ticket (crafted to produce two close-scoring OPC candidates) escalates per §6A rather than auto-selecting either OPC
- at least one R2-class action runs under `ON_BEHALF_OF` identity (§14A), with the recorded executor identity matching the human approver, not the platform service account

---

# 35. Three OPCs for Schema Validation

## OPC A — Data Reconciliation

```text
request
-> query application state
-> query runtime state
-> compare
-> diagnose
-> propose reconciliation
-> approval
-> execute
-> verify parity
```

## OPC B — Production Error Spike

```text
alert
-> logs/metrics
-> isolate service
-> choose registered remediation
-> policy
-> execute
-> verify health
```

## OPC C — Access / Entitlement Issue

```text
support ticket
-> retrieve application entitlement state
-> diagnose missing/incorrect access
-> propose approved remediation
-> approval if required
-> execute
-> verify access state
```

If these require scenario-specific runtime branches, the schema/runtime abstraction is incomplete.

---

# 36. Deferred: Engineering Context — Phase 2

Engineering Context is architecturally valuable but not required to prove v0.1.

Potential sources:

- Product Repo
- ADRs
- design artifacts
- deployment manifests
- pull requests
- commits
- change tickets

Future reasoning chain:

```text
incident
-> recent deployment
-> changed code
-> linked change artifact
-> architecture intent
-> runtime deviation
```

### Critical dependency
This capability is trustworthy only if code, deployments, and artifacts are linked and reasonably current.

The platform must expose artifact freshness/provenance rather than assuming design documentation is authoritative.

---

# 37. Deferred: Business Context — Phase 3

Business Context must not remain an undefined architecture label.

Proposed definition:

```yaml
BusinessContext:
  service_tier: string
  business_capability: string
  customer_impact_class: string
  sla: object
  blackout_windows: [object]
  critical_business_periods: [object]
  regulatory_tags: [string]
  owning_business_group: string
```

Potential uses:

- risk calculation
- approval routing
- incident prioritization
- change restrictions
- executive impact reporting

This is deferred until the core operational resolution loop is proven.

---

# 38. Suggested Implementation Sequence

## Iteration 1 — Contracts

Implement:

- OperationalProcedureContract
- IncomingRequest
- ProposedAction
- PolicyDecision
- ExecutionResult
- Evidence

Validate against three OPCs.

## Iteration 2 — Happy-path runtime

Implement:

- webhook trigger
- OPC matcher
- durable state machine
- mock context connectors
- investigator
- planner

No mutation yet.

## Iteration 3 — Governance

Implement:

- Action Registry
- Policy Engine
- Slack approval
- frozen plan
- signed execution authorization

## Iteration 4 — Execution

Implement:

- one real context connector
- one real action connector
- verification
- rollback path

## Iteration 5 — Evidence + dashboard

Implement:

- evidence ledger
- execution timeline
- operational KPIs
- governance dashboard

## Iteration 6 — Second unrelated tenant/OPC

Add a deliberately different workflow without changing runtime code.

This is the primary genericity test.

---

# 39. Architecture Decision Summary

| Decision | v0.2 |
|---|---|
| Configuration-driven runtime | Yes |
| Generic OPC (Operational Procedure Contract) schema | Yes |
| Durable orchestration | Yes |
| Application Context | Yes |
| Runtime Context | Yes |
| Historical Evidence | Yes |
| Minimal Change Context (§8) | Yes |
| Full Engineering Context | Deferred |
| Business Context | Deferred |
| `OperationalWorkUnit` as distinct abstraction | Not added — `IncomingRequest` sufficient |
| Read/write connector separation | Yes |
| Human approval gates | Yes |
| Frozen approved plan | Yes |
| Deterministic policy engine | Yes |
| Execution identity delegation (OBO) (§14A) | Yes — required by default for R2/R3 |
| Emergency halt / kill switch (§7A) | Yes |
| Pre-execution drift check (§14B) | Yes — mandatory before mutating execution |
| Context staleness bounds (§10) | Yes — tenant-configurable `max_age_seconds` |
| Token/cost budget per OPC (§7B) | Yes — default ESCALATE on exceeded |
| Deterministic OPC-match guardrail (§6A) | Yes — margin threshold, ambiguous cases escalate |
| Automatic autonomy graduation | No |
| Evidence-based graduation framework | Defined |
| Autonomy Ladder (§17.1) | Yes — documentation/dashboard layer, L3 ceiling |
| Standalone Autonomy Graduation Engine | Not built — reuses existing policy model |
| Numeric model confidence for leadership | No |
| Evidence relationship fields (§4.6) | Yes — `supports`/`contradicts`/`derived_from`/`supersedes` |
| Standalone Evidence Graph store | Not built — relational ledger sufficient |
| Verification after execution | Mandatory |
| Rollback support | Yes |
| Evidence ledger | Yes |
| Control Tower | Yes |
| True multi-tenant SaaS deployment | Optional later |
| Multi-tenant-safe contracts/data model | Yes |

---

# 40. Architectural Thesis

The product is not an AI chatbot attached to operational tooling.

It is a **governed operational runtime** in which:

- organizations configure triggers, OPCs, context, actions, and policy
- agents investigate and plan using bounded evidence-backed context
- deterministic policy controls authority
- humans gate higher-risk work
- executors perform only registered actions
- verification determines success
- evidence records every decision and outcome
- historical outcomes eventually enable carefully governed autonomy

The long-term Context Fabric can grow to include engineering and business context, but those capabilities should be layered on only after the core operational loop has been proven with real tickets.
