/**
 * @aop/evidence-ledger — Prisma-backed relational core (spec §32).
 *
 * This package exports the generated Prisma client and its types.
 * Repository methods live in src/repositories/ and are added by the
 * stories that actually need them (CONTEXT.md RULE 4: every repository
 * method takes tenant_id explicitly, no bare-ID lookups) — C-01
 * (IdentityResolver → identity_principal), D-07 (crash-recovery →
 * execution_step_marker), E-01/E-02 (Evidence Ledger persistence,
 * outbox emission) are the first consumers. Nothing here yet, since a
 * repository written ahead of its caller tends to guess at the wrong
 * shape.
 */
export * from "./retention/retention-policy.js";
export * from "./repositories/evidence-repository.js";
export * from "./repositories/prisma-evidence-repository.js";
export * from "./outbox/outbox-event.js";
export * from "./outbox/relay-lag.js";
export * from "./outbox/outbox-relay.js";
export * from "./outbox/deduping-event-consumer.js";
export * from "./outbox/prisma-ledger-writer.js";
export * from "./outbox/prisma-outbox-store.js";
export * from "./read/execution-history.js";
export * from "./read/engineering-context-package-view.js";
export * from "./read/prisma-control-tower-repository.js";
export { PrismaClient, Prisma } from "@prisma/client";
export type {
  Tenant,
  OpcDefinition,
  ConnectorDefinition,
  ActionDefinition,
  IncomingRequest,
  Execution,
  ContextPackageRow,
  EvidenceRow,
  ProposedActionRow,
  PolicyDecisionRow,
  ActionExecutionRow,
  VerificationRow,
  ExecutionStepMarker,
  OutboxEvent,
  IdentityPrincipal,
} from "@prisma/client";
