import type { ConnectorDescriptor } from "@aop/contracts";

/**
 * ContextConnector — spec §10's read-only Connector Registry interface.
 * Deliberately has no write/mutate method: NFR-02 ("Read connectors
 * cannot expose write operations through the same interface") is
 * enforced structurally — there is nothing on this interface capable of
 * mutating anything, not a runtime check on an interface that could. See
 * CONTEXT.md RULE 3: read and write connectors are separate interfaces in
 * separate packages, and a single class must never implement both —
 * `ActionConnector` (the write counterpart) lives in
 * `packages/action-executor` (D-01), a different package entirely.
 */
export interface ContextConnector {
  descriptor(): ConnectorDescriptor;
  validateConfig(config: ConnectorConfig): ValidationResult;
  executeRead(
    operation: string,
    input: Record<string, unknown>,
    executionContext: ConnectorExecutionContext,
  ): Promise<ConnectorReadResult>;
}

export type ConnectorConfig = Record<string, unknown>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ConnectorExecutionContext {
  tenantId: string;
  requestId: string;
  executionId: string;
}

export interface ConnectorReadResult {
  data: unknown;
  /** ISO timestamp — when the underlying source produced this data (not when this call ran). */
  retrieved_at: string;
  /** Provenance reference for ContextPackage.provenance (spec §9). */
  query_ref: string;
}

/**
 * Thrown by a ContextConnector.executeRead() implementation when it has no
 * data to return for the requested operation/input — distinct from an
 * unexpected error, so assembleContextPackage() can route it to
 * ContextPackage.missing_context instead of letting it propagate as a
 * genuine bug.
 */
export class ContextUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ContextUnavailableError";
  }
}
