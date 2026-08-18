import { describe, expect, it } from "vitest";
import { OPCMatchResultSchema } from "./opc-match-result.js";

describe("OPCMatchResultSchema", () => {
  it("accepts a MATCHED result with a selected_opc_id and margin above threshold", () => {
    const matched = {
      request_id: "req_1",
      candidates: [
        { opc_id: "opc_a", opc_version: "1.0.0", match_score: 0.9 },
        { opc_id: "opc_b", opc_version: "1.0.0", match_score: 0.5 },
      ],
      selected_opc_id: "opc_a",
      match_margin: 0.4,
      minimum_required_margin: 0.15,
      outcome: "MATCHED",
    };
    expect(OPCMatchResultSchema.safeParse(matched).success).toBe(true);
  });

  it("CRITICAL: accepts an AMBIGUOUS_ESCALATE outcome with no selected_opc_id — spec §6A requires the runtime never silently auto-pick between close candidates", () => {
    const ambiguous = {
      request_id: "req_2",
      candidates: [
        { opc_id: "opc_a", opc_version: "1.0.0", match_score: 0.62 },
        { opc_id: "opc_b", opc_version: "1.0.0", match_score: 0.58 },
      ],
      match_margin: 0.04,
      minimum_required_margin: 0.15,
      outcome: "AMBIGUOUS_ESCALATE",
    };
    const parsed = OPCMatchResultSchema.safeParse(ambiguous);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.selected_opc_id).toBeUndefined();
  });

  it("accepts an empty candidates array (no OPC met the minimum match policy)", () => {
    const none = {
      request_id: "req_3",
      candidates: [],
      minimum_required_margin: 0.15,
      outcome: "AMBIGUOUS_ESCALATE",
    };
    expect(OPCMatchResultSchema.safeParse(none).success).toBe(true);
  });

  it("rejects an out-of-enum outcome value", () => {
    const broken = {
      request_id: "req_1",
      candidates: [],
      minimum_required_margin: 0.15,
      outcome: "EH_CLOSE_ENOUGH",
    };
    expect(OPCMatchResultSchema.safeParse(broken).success).toBe(false);
  });
});
