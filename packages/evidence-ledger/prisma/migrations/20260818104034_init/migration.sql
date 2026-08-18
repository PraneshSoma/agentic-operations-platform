-- CreateEnum
CREATE TYPE "RiskClass" AS ENUM ('R0', 'R1', 'R2', 'R3');

-- CreateEnum
CREATE TYPE "OpcStatus" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "ExecutionStateValue" AS ENUM ('RECEIVED', 'OPC_MATCHED', 'CONTEXT_ASSEMBLY', 'INVESTIGATING', 'DIAGNOSED', 'PLANNED', 'WAITING_APPROVAL', 'EXECUTING', 'EXECUTION_UNCERTAIN', 'VERIFYING', 'ROLLING_BACK', 'RESOLVED', 'ESCALATED', 'ESCALATED_HUMAN_OVERRIDE', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('logs', 'metrics', 'database', 'api', 'knowledge');

-- CreateEnum
CREATE TYPE "CompensationClass" AS ENUM ('REVERSIBLE', 'COMPENSATABLE', 'IRREVERSIBLE');

-- CreateEnum
CREATE TYPE "ReliabilityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'AUTHORITATIVE');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('REQUEST', 'CONTEXT', 'OBSERVATION', 'HYPOTHESIS', 'PLAN', 'APPROVAL', 'ACTION_RESULT', 'VERIFICATION', 'ROLLBACK', 'OUTCOME');

-- CreateEnum
CREATE TYPE "RetentionClass" AS ENUM ('operational_state', 'prompts', 'evidence_record', 'secrets_redacted_payload', 'audit_hash');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'REQUIRE_APPROVAL', 'DENY');

-- CreateEnum
CREATE TYPE "HardDenyReasonCode" AS ENUM ('UNREGISTERED_ACTION', 'TENANT_MISMATCH', 'EXPIRED_AUTHORIZATION', 'PROHIBITED_ENVIRONMENT', 'MISSING_REQUIRED_EVIDENCE', 'KILL_SWITCH_ACTIVE', 'IMMUTABLE_POLICY_VIOLATION', 'POLICY_EVALUATION_FAILED');

-- CreateEnum
CREATE TYPE "ExecutionResultStatus" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "VerificationOverall" AS ENUM ('VERIFIED', 'FAILED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "RecommendedNextStep" AS ENUM ('CLOSE', 'ROLLBACK', 'ESCALATE');

-- CreateEnum
CREATE TYPE "MarkerStatus" AS ENUM ('ATTEMPTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retention_policy_confirmed_at" TIMESTAMP(3),
    "production_activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opc_definition" (
    "id" TEXT NOT NULL,
    "opc_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OpcStatus" NOT NULL,
    "match" JSONB NOT NULL,
    "required_context" JSONB NOT NULL,
    "investigation" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "verification" JSONB NOT NULL,
    "escalation" JSONB NOT NULL,
    "rollback" JSONB NOT NULL,
    "timeout" JSONB NOT NULL,
    "budget" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opc_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_definition" (
    "id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "operations" JSONB NOT NULL,
    "authorization" JSONB NOT NULL,
    "scopes" JSONB NOT NULL,
    "staleness" JSONB NOT NULL,
    "definition_version" TEXT NOT NULL,
    "supports_correlation" BOOLEAN NOT NULL DEFAULT false,
    "is_idempotent" BOOLEAN NOT NULL DEFAULT false,
    "reliability_level" "ReliabilityLevel" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_definition" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "executor_connector_ref" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL,
    "default_risk_class" "RiskClass" NOT NULL,
    "blast_radius" JSONB NOT NULL,
    "reversible" BOOLEAN NOT NULL,
    "rollback_action_ref" TEXT,
    "environment_constraints" JSONB NOT NULL,
    "policy_tags" TEXT[],
    "status" "ActionStatus" NOT NULL,
    "compensation_class" "CompensationClass" NOT NULL,
    "risk_scoring_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_request" (
    "request_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "requester" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "raw_payload_ref" TEXT NOT NULL,
    "correlation" JSONB NOT NULL,

    CONSTRAINT "incoming_request_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "execution" (
    "execution_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "opc_id" TEXT NOT NULL,
    "opc_version" TEXT NOT NULL,
    "state" "ExecutionStateValue" NOT NULL,
    "context_package_ref" TEXT,
    "proposal_ids" TEXT[],
    "current_proposal_id" TEXT,
    "retry_count" INTEGER NOT NULL,
    "budget_consumed" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_pkey" PRIMARY KEY ("execution_id")
);

-- CreateTable
CREATE TABLE "context_package" (
    "context_package_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "opc_id" TEXT NOT NULL,
    "assembled_at" TIMESTAMP(3) NOT NULL,
    "application_context" JSONB NOT NULL,
    "runtime_context" JSONB NOT NULL,
    "historical_evidence" JSONB NOT NULL,
    "missing_context" JSONB NOT NULL,
    "stale_context" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "context_package_pkey" PRIMARY KEY ("context_package_id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "evidence_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "source" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "relationships" JSONB NOT NULL,
    "integrity" JSONB NOT NULL,
    "retention_class" "RetentionClass" NOT NULL,
    "retention_expires_at" TIMESTAMP(3) NOT NULL,
    "retention_policy_version" TEXT NOT NULL,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateTable
CREATE TABLE "proposed_action" (
    "proposal_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action_ref" TEXT NOT NULL,
    "action_version" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "expected_outcome" TEXT NOT NULL,
    "risk_assessment" JSONB NOT NULL,
    "supporting_evidence_ids" TEXT[],
    "generated_by" JSONB NOT NULL,
    "accountable_principal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposed_action_pkey" PRIMARY KEY ("proposal_id")
);

-- CreateTable
CREATE TABLE "policy_decision" (
    "decision_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "effective_risk_class" "RiskClass" NOT NULL,
    "outcome" "PolicyOutcome" NOT NULL,
    "approval_route" TEXT,
    "reasons" JSONB NOT NULL,
    "evidence_summary" JSONB NOT NULL,
    "hard_deny_reason_code" "HardDenyReasonCode",
    "hard_deny_detail" TEXT,
    "requires_proposer_approver_separation" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_decision_pkey" PRIMARY KEY ("decision_id")
);

-- CreateTable
CREATE TABLE "action_execution" (
    "execution_result_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "action_ref" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "status" "ExecutionResultStatus" NOT NULL,
    "provider_reference" TEXT,
    "output_summary" TEXT NOT NULL,
    "side_effects" JSONB NOT NULL,
    "error" JSONB NOT NULL,
    "rollback_available" BOOLEAN NOT NULL,
    "executor_build_hash" TEXT NOT NULL,

    CONSTRAINT "action_execution_pkey" PRIMARY KEY ("execution_result_id")
);

-- CreateTable
CREATE TABLE "verification" (
    "verification_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_result_id" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "overall" "VerificationOverall" NOT NULL,
    "recommended_next_step" "RecommendedNextStep" NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("verification_id")
);

-- CreateTable
CREATE TABLE "execution_step_marker" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "action_ref" TEXT NOT NULL,
    "action_version" TEXT NOT NULL,
    "connector_ref" TEXT NOT NULL,
    "connector_version" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "MarkerStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "execution_step_marker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "event_schema_version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_principal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "roles" TEXT[],
    "is_development_principal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_principal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opc_definition_tenant_id_idx" ON "opc_definition"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "opc_definition_tenant_id_opc_id_version_key" ON "opc_definition"("tenant_id", "opc_id", "version");

-- CreateIndex
CREATE INDEX "connector_definition_tenant_id_idx" ON "connector_definition"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "connector_definition_tenant_id_connector_id_definition_vers_key" ON "connector_definition"("tenant_id", "connector_id", "definition_version");

-- CreateIndex
CREATE INDEX "action_definition_tenant_id_idx" ON "action_definition"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_definition_tenant_id_action_id_version_key" ON "action_definition"("tenant_id", "action_id", "version");

-- CreateIndex
CREATE INDEX "incoming_request_tenant_id_idx" ON "incoming_request"("tenant_id");

-- CreateIndex
CREATE INDEX "execution_tenant_id_idx" ON "execution"("tenant_id");

-- CreateIndex
CREATE INDEX "execution_tenant_id_request_id_idx" ON "execution"("tenant_id", "request_id");

-- CreateIndex
CREATE INDEX "context_package_tenant_id_idx" ON "context_package"("tenant_id");

-- CreateIndex
CREATE INDEX "evidence_tenant_id_execution_id_idx" ON "evidence"("tenant_id", "execution_id");

-- CreateIndex
CREATE INDEX "proposed_action_tenant_id_execution_id_idx" ON "proposed_action"("tenant_id", "execution_id");

-- CreateIndex
CREATE INDEX "policy_decision_tenant_id_proposal_id_idx" ON "policy_decision"("tenant_id", "proposal_id");

-- CreateIndex
CREATE INDEX "action_execution_tenant_id_proposal_id_idx" ON "action_execution"("tenant_id", "proposal_id");

-- CreateIndex
CREATE INDEX "verification_tenant_id_execution_result_id_idx" ON "verification"("tenant_id", "execution_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "execution_step_marker_tenant_id_execution_id_step_id_operat_key" ON "execution_step_marker"("tenant_id", "execution_id", "step_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_event_id_key" ON "outbox_event"("event_id");

-- CreateIndex
CREATE INDEX "outbox_event_tenant_id_available_at_idx" ON "outbox_event"("tenant_id", "available_at");

-- CreateIndex
CREATE INDEX "identity_principal_tenant_id_idx" ON "identity_principal"("tenant_id");
