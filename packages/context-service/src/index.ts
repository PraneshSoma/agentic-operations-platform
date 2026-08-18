/**
 * @aop/context-service — ContextConnector interface + registry (§8-9),
 * Context Package assembly, staleness enforcement. The simulated
 * connector (B-04, now resolving its credential via @aop/secrets per
 * ADR-009/C-05) + assembly function exist so far; real connectors
 * (logs/metrics/database/api/knowledge against real systems) are later
 * stories' job.
 */
export * from "./connector.js";
export * from "./fixtures/simulated-fixture-connector.js";
export * from "./assembly/assemble-context-package.js";
