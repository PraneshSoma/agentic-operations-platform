import type { ConnectorDescriptor } from "@aop/contracts";
import {
  ContextUnavailableError,
  type ConnectorConfig,
  type ConnectorExecutionContext,
  type ConnectorReadResult,
  type ContextConnector,
  type ValidationResult,
} from "../connector.js";

export interface FixtureEntry {
  data: unknown;
  retrievedAt: Date;
}

/**
 * SimulatedFixtureConnector — a ContextConnector backed entirely by an
 * in-memory fixture map, not a real system (story B-04's explicit scope:
 * "against fixture/fake data, not a real system"). One instance covers
 * one connector_ref; the same class backs application/runtime/evidence
 * context types (the interface and behavior — lookup, staleness, missing
 * data — are identical across all three; only the fixture data and
 * ConnectorDescriptor differ).
 *
 * A fixture entry set to the literal string "unavailable" simulates a
 * source that has no data for that key (story acceptance criterion:
 * "missing_context ... populate correctly when a fixture is configured as
 * unavailable"). A fixture entry with a `retrievedAt` older than the
 * connector's own `staleness.max_age_seconds` simulates stale data —
 * staleness detection itself lives in assembleContextPackage(), not here;
 * this connector just honestly reports how old its data really is.
 */
export class SimulatedFixtureConnector implements ContextConnector {
  constructor(
    private readonly connectorDescriptor: ConnectorDescriptor,
    private readonly fixtures: ReadonlyMap<string, FixtureEntry | "unavailable">,
  ) {}

  descriptor(): ConnectorDescriptor {
    return this.connectorDescriptor;
  }

  validateConfig(_config: ConnectorConfig): ValidationResult {
    // A simulated connector has no real external config to validate against.
    return { valid: true, errors: [] };
  }

  async executeRead(
    operation: string,
    input: Record<string, unknown>,
    _executionContext: ConnectorExecutionContext,
  ): Promise<ConnectorReadResult> {
    const key = typeof input.key === "string" ? input.key : "default";
    const fixture = this.fixtures.get(key);

    if (fixture === undefined || fixture === "unavailable") {
      throw new ContextUnavailableError(
        `${this.connectorDescriptor.connector_id}: no fixture data for key "${key}" (operation "${operation}")`,
      );
    }

    return {
      data: fixture.data,
      retrieved_at: fixture.retrievedAt.toISOString(),
      query_ref: `simulated:${this.connectorDescriptor.connector_id}:${operation}:${key}`,
    };
  }
}
