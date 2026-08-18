/**
 * @aop/context-service — ContextConnector interface + registry (§8-9),
 * Context Package assembly, staleness enforcement. Only the simulated
 * connector + assembly function exist so far (story B-04); real
 * connectors (logs/metrics/database/api/knowledge against real systems)
 * are later stories' job.
 */
export * from "./connector.js";
export * from "./fixtures/simulated-fixture-connector.js";
export * from "./assembly/assemble-context-package.js";
