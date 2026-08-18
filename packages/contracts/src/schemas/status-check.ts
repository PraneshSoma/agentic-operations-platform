import { z } from "zod";

/**
 * Status-check contracts (LLD-v1 §6, ADR-004) — the body/response shape
 * for `POST /internal/connectors/{connector_ref}/status-check`, the
 * mandatory check the orchestrator runs on entering EXECUTION_UNCERTAIN.
 * The version fields let a connector reject a check against a build it
 * doesn't recognize rather than guessing.
 */
export const StatusCheckRequestSchema = z.object({
  operation_id: z.string(),
  action_version: z.string(),
  connector_version: z.string(),
});
export type StatusCheckRequest = z.infer<typeof StatusCheckRequestSchema>;

/**
 * outcome is the three-way answer ADR-004's decision tree branches on:
 * CONFIRMED_NOT_EXECUTED -> safe retry, same operation_id;
 * CONFIRMED_EXECUTED -> proceed to VERIFYING;
 * INCONCLUSIVE -> fail-closed unless the connector is provably idempotent
 * (ConnectorDescriptor.is_idempotent), never an implicit pass.
 */
export const StatusCheckResultSchema = z.object({
  outcome: z.enum(["CONFIRMED_EXECUTED", "CONFIRMED_NOT_EXECUTED", "INCONCLUSIVE"]),
  detail: z.string().optional(),
});
export type StatusCheckResult = z.infer<typeof StatusCheckResultSchema>;
