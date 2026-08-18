import { describe, expect, it } from "vitest";
import { OperationalProcedureContractSchema } from "./operational-procedure-contract.js";
import {
  OPC_A_DATA_RECONCILIATION,
  OPC_B_PRODUCTION_ERROR_SPIKE,
  OPC_C_ACCESS_ENTITLEMENT_ISSUE,
} from "./operational-procedure-contract.fixtures.js";

/**
 * Story A-04: spec §35's schema-validation exercise. "If these require
 * scenario-specific runtime branches, the schema/runtime abstraction is
 * incomplete." All three fixtures use the exact same
 * OperationalProcedureContractSchema, unmodified — no per-OPC field, no
 * discriminated union, no OPC-type-specific branch anywhere in
 * @aop/contracts. That is the abstraction-completeness claim this test
 * makes: it is proven by all three parsing through one unmodified schema,
 * not by any runtime code (there is none to write here yet — the
 * orchestrator that consumes these lands in Phase B).
 */
describe("OPC schema validation — spec §35's three worked scenarios", () => {
  it.each([
    ["OPC A — Data Reconciliation", OPC_A_DATA_RECONCILIATION],
    ["OPC B — Production Error Spike", OPC_B_PRODUCTION_ERROR_SPIKE],
    ["OPC C — Access / Entitlement Issue", OPC_C_ACCESS_ENTITLEMENT_ISSUE],
  ])("%s parses cleanly through OperationalProcedureContractSchema", (_name, opc) => {
    const parsed = OperationalProcedureContractSchema.safeParse(opc);
    expect(parsed.success).toBe(true);
  });

  it("all three OPCs share one schema with no scenario-specific field present in only one of them", () => {
    // Cheap structural proof alongside the parse proof above: the same
    // top-level key set describes a data-integrity flow, an
    // incident-remediation flow, and an access-request flow.
    const keysOf = (o: object) => Object.keys(o).sort();
    expect(keysOf(OPC_A_DATA_RECONCILIATION)).toEqual(keysOf(OPC_B_PRODUCTION_ERROR_SPIKE));
    expect(keysOf(OPC_B_PRODUCTION_ERROR_SPIKE)).toEqual(keysOf(OPC_C_ACCESS_ENTITLEMENT_ISSUE));
  });
});
