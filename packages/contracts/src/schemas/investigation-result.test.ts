import { describe, expect, it } from "vitest";
import { InvestigationResultSchema } from "./investigation-result.js";

const validPayload = {
  observations: [{ id: "obs_1", statement: "error rate elevated since 14:03 UTC", evidence_ids: ["ev_1"] }],
  hypotheses: [
    {
      id: "hyp_1",
      description: "recent deploy introduced a regression",
      supporting_evidence_ids: ["ev_1"],
      contradicting_evidence_ids: [],
      status: "supported",
    },
  ],
  diagnosis: { summary: "deploy-induced error spike", evidence_ids: ["ev_1"] },
  missing_information: [],
  recommended_next_step: "PLAN",
};

describe("InvestigationResultSchema", () => {
  it("accepts a valid payload matching spec §11's shape", () => {
    expect(InvestigationResultSchema.safeParse(validPayload).success).toBe(true);
  });

  it("accepts empty observations/hypotheses/missing_information arrays", () => {
    const empty = { ...validPayload, observations: [], hypotheses: [], missing_information: ["no logs available"] };
    expect(InvestigationResultSchema.safeParse(empty).success).toBe(true);
  });

  it.each(["supported", "rejected", "unresolved"])("accepts hypothesis status %s", (status) => {
    const withStatus = { ...validPayload, hypotheses: [{ ...validPayload.hypotheses[0], status }] };
    expect(InvestigationResultSchema.safeParse(withStatus).success).toBe(true);
  });

  it("CRITICAL: rejects a hypothesis with a missing status — every hypothesis must be marked explicitly", () => {
    const broken = structuredClone(validPayload) as { hypotheses: Array<Record<string, unknown>> };
    delete broken.hypotheses[0]!.status;
    expect(InvestigationResultSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum hypothesis status", () => {
    const broken = { ...validPayload, hypotheses: [{ ...validPayload.hypotheses[0], status: "probably_true" }] };
    expect(InvestigationResultSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an out-of-enum recommended_next_step", () => {
    const broken = { ...validPayload, recommended_next_step: "GUESS" };
    expect(InvestigationResultSchema.safeParse(broken).success).toBe(false);
  });

  it.each(["observations", "hypotheses", "diagnosis", "missing_information", "recommended_next_step"])(
    "rejects when required top-level field %s is missing",
    (field) => {
      const broken = structuredClone(validPayload) as Record<string, unknown>;
      delete broken[field];
      expect(InvestigationResultSchema.safeParse(broken).success).toBe(false);
    },
  );
});
