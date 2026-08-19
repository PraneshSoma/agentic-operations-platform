import {
  ContextPackageSchema,
  EvidenceSchema,
  ExecutionResultSchema,
  ExecutionStateSchema,
  PolicyDecisionSchema,
  ProposedActionSchema,
  VerificationResultSchema,
  type ContextPackage,
  type Evidence,
  type ExecutionResult,
  type ExecutionState,
  type PolicyDecision,
  type ProposedAction,
  type VerificationResult,
} from "@aop/contracts";
import type { PrismaClient } from "@prisma/client";
import { buildExecutionHistory, type ExecutionHistory } from "./execution-history.js";
import { buildEngineeringContextPackageView, type ControlTowerRepository, type EngineeringContextPackageView } from "./engineering-context-package-view.js";
import { buildVersionBindingView, type VersionBindingView } from "./version-binding-view.js";

/**
 * Prisma-backed ControlTowerRepository (story E-05, F-16, OI-REQ-02). A
 * pure read layer: it fetches the rows an execution touched, tenant-scoped
 * throughout, and hands them to the pure view/history builders. It writes
 * nothing and changes no schema — the composite is a read-time join by
 * execution_id (OI-REQ-02's decision), not a stored object.
 *
 * Integration-tested against a real Postgres (the joins and tenant
 * scoping are DB-level), excluded from the default unit-coverage gate;
 * the pure builders it delegates to ARE covered there.
 */
export class PrismaControlTowerRepository implements ControlTowerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async reconstructExecutionHistory(tenantId: string, executionId: string): Promise<ExecutionHistory | undefined> {
    const execution = await this.prisma.execution.findUnique({ where: { execution_id: executionId } });
    if (!execution || execution.tenant_id !== tenantId) return undefined;
    const evidence = await this.fetchEvidence(tenantId, executionId);
    return buildExecutionHistory(tenantId, executionId, evidence);
  }

  async getCompositeContextPackage(tenantId: string, executionId: string): Promise<EngineeringContextPackageView | undefined> {
    const executionRow = await this.prisma.execution.findUnique({ where: { execution_id: executionId } });
    if (!executionRow || executionRow.tenant_id !== tenantId) return undefined;
    const execution: ExecutionState = ExecutionStateSchema.parse(iso(executionRow, ["created_at", "updated_at"]));

    const contextRow = await this.prisma.contextPackageRow.findFirst({
      where: { tenant_id: tenantId, request_id: execution.request_id },
      orderBy: { assembled_at: "desc" },
    });
    const contextPackage: ContextPackage | null = contextRow
      ? ContextPackageSchema.parse({ ...iso(contextRow, ["assembled_at"]), context_package_id: contextRow.context_package_id })
      : null;

    const proposalRows = await this.prisma.proposedActionRow.findMany({ where: { tenant_id: tenantId, execution_id: executionId } });
    const proposedActions: ProposedAction[] = proposalRows.map((r) => ProposedActionSchema.parse(iso(r, ["created_at"])));

    const proposalIds = proposedActions.map((p) => p.proposal_id);
    const decisionRows = proposalIds.length
      ? await this.prisma.policyDecisionRow.findMany({ where: { tenant_id: tenantId, proposal_id: { in: proposalIds } } })
      : [];
    const policyDecisions: PolicyDecision[] = decisionRows.map((r) => PolicyDecisionSchema.parse(iso(r, ["created_at"])));

    const executionResultRows = proposalIds.length
      ? await this.prisma.actionExecutionRow.findMany({ where: { tenant_id: tenantId, proposal_id: { in: proposalIds } } })
      : [];
    const resultIds = executionResultRows.map((r) => r.execution_result_id);
    const verificationRows = resultIds.length
      ? await this.prisma.verificationRow.findMany({ where: { tenant_id: tenantId, execution_result_id: { in: resultIds } } })
      : [];
    const verifications: VerificationResult[] = verificationRows.map((r) => VerificationResultSchema.parse(r));

    const evidence = await this.fetchEvidence(tenantId, executionId);

    return buildEngineeringContextPackageView({ execution, contextPackage, proposedActions, policyDecisions, verifications, evidence });
  }

  async getVersionBinding(tenantId: string, executionId: string): Promise<VersionBindingView | undefined> {
    const executionRow = await this.prisma.execution.findUnique({ where: { execution_id: executionId } });
    if (!executionRow || executionRow.tenant_id !== tenantId) return undefined;
    const execution: ExecutionState = ExecutionStateSchema.parse(iso(executionRow, ["created_at", "updated_at"]));

    const proposalRows = await this.prisma.proposedActionRow.findMany({ where: { tenant_id: tenantId, execution_id: executionId } });
    const proposedActions: ProposedAction[] = proposalRows.map((r) => ProposedActionSchema.parse(iso(r, ["created_at"])));
    const proposalIds = proposedActions.map((p) => p.proposal_id);

    const decisionRows = proposalIds.length
      ? await this.prisma.policyDecisionRow.findMany({ where: { tenant_id: tenantId, proposal_id: { in: proposalIds } } })
      : [];
    const policyDecisions: PolicyDecision[] = decisionRows.map((r) => PolicyDecisionSchema.parse(iso(r, ["created_at"])));

    const resultRows = proposalIds.length
      ? await this.prisma.actionExecutionRow.findMany({ where: { tenant_id: tenantId, proposal_id: { in: proposalIds } } })
      : [];
    const executionResults: ExecutionResult[] = resultRows.map((r) => ExecutionResultSchema.parse(iso(r, ["started_at", "completed_at"])));

    // Connector definition versions: the connectors that assembled this
    // execution's context are named in the context package's provenance;
    // join their connector_definition rows for the pinned versions.
    const connectorDefinitionVersions = await this.fetchConnectorDefinitionVersions(tenantId, execution.request_id);

    // Frozen plan id / approval id have no dedicated table yet — read them
    // from the evidence chain where the orchestrator recorded them.
    const evidence = await this.fetchEvidence(tenantId, executionId);
    const frozenPlanIds = collectStructuredIds(evidence, "PLAN", "plan_id");
    const approvalIds = collectStructuredIds(evidence, "APPROVAL", "approval_id");

    return buildVersionBindingView({
      execution,
      proposedActions,
      policyDecisions,
      executionResults,
      connectorDefinitionVersions,
      frozenPlanIds,
      approvalIds,
    });
  }

  private async fetchConnectorDefinitionVersions(
    tenantId: string,
    requestId: string,
  ): Promise<Array<{ connector_id: string; definition_version: string }>> {
    const contextRow = await this.prisma.contextPackageRow.findFirst({
      where: { tenant_id: tenantId, request_id: requestId },
      orderBy: { assembled_at: "desc" },
    });
    if (!contextRow) return [];
    const provenance = Array.isArray(contextRow.provenance) ? (contextRow.provenance as Array<{ connector_ref?: string }>) : [];
    const connectorRefs = [...new Set(provenance.map((p) => p.connector_ref).filter((r): r is string => typeof r === "string"))];
    if (connectorRefs.length === 0) return [];

    const rows = await this.prisma.connectorDefinition.findMany({
      where: { tenant_id: tenantId, connector_id: { in: connectorRefs } },
      select: { connector_id: true, definition_version: true },
    });
    return rows.map((r) => ({ connector_id: r.connector_id, definition_version: r.definition_version }));
  }

  private async fetchEvidence(tenantId: string, executionId: string): Promise<Evidence[]> {
    const rows = await this.prisma.evidenceRow.findMany({ where: { tenant_id: tenantId, execution_id: executionId } });
    return rows.map((r) => EvidenceSchema.parse(iso(r, ["retention_expires_at"])));
  }
}

/** Pulls a structured id (e.g. plan_id / approval_id) from evidence records of a given type. */
function collectStructuredIds(evidence: Evidence[], type: Evidence["type"], key: string): string[] {
  const ids: string[] = [];
  for (const record of evidence) {
    if (record.type !== type) continue;
    const value = record.content.structured_data?.[key];
    if (typeof value === "string") ids.push(value);
  }
  return ids;
}

/**
 * Prepares a Prisma row for parsing through the domain Zod schemas:
 * named Date columns become ISO strings, and nullable columns that came
 * back `null` are dropped so the schemas' `.optional()` (undefined) fields
 * accept them. Storage-only columns (e.g. the denormalized `tenant_id` on
 * policy_decision, or Prisma's internal `id`) are simply ignored by the
 * schemas' strict-by-default object parse of the fields they declare.
 */
function iso<T extends Record<string, unknown>>(row: T, dateFields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null) continue; // null column -> undefined (drop the key)
    out[key] = value;
  }
  for (const field of dateFields) {
    const value = out[field];
    if (value instanceof Date) out[field] = value.toISOString();
  }
  return out;
}
