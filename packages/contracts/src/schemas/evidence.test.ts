import { describe, expect, it } from "vitest";
import { EvidenceSchema } from "./evidence.js";

function omit<T extends object>(obj: T, path: string): T {
  const clone = structuredClone(obj);
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = clone;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]!];
  delete cur[parts[parts.length - 1]!];
  return clone;
}

const validPayload = {
  evidence_id: "ev_1",
  tenant_id: "tenant_abc",
  request_id: "req_1",
  execution_id: "exec_1",
  type: "OBSERVATION",
  source: { component: "investigator", connector_ref: "logs-connector", source_reference: "query_1" },
  content: { summary: "5xx rate elevated 3x baseline since 14:02 UTC", structured_data: { rate: 0.15 } },
  relationships: { supports: ["ev_0"], contradicts: [], derived_from: ["ev_0"] },
  integrity: { created_at: "2026-08-17T00:00:00.000Z", content_hash: "sha256:abc" },
  retention_class: "evidence_record",
  retention_expires_at: "2026-11-15T00:00:00.000Z",
  retention_policy_version: "dev-default-90d-v1",
  legal_hold: false,
};

describe("EvidenceSchema", () => {
  it("accepts a valid payload matching spec §4.6's shape, including the ADR-011 retention fields", () => {
    expect(EvidenceSchema.safeParse(validPayload).success).toBe(true);
  });

  it("defaults legal_hold to false when omitted", () => {
    const withoutLegalHold = omit(validPayload, "legal_hold");
    const parsed = EvidenceSchema.parse(withoutLegalHold);
    expect(parsed.legal_hold).toBe(false);
  });

  it("accepts a correction record via relationships.supersedes — the append-only correction pattern (spec §21)", () => {
    const correction = { ...validPayload, evidence_id: "ev_2", relationships: { supersedes: "ev_1" } };
    expect(EvidenceSchema.safeParse(correction).success).toBe(true);
  });

  it.each([
    "evidence_id",
    "tenant_id",
    "request_id",
    "execution_id",
    "type",
    "source.component",
    "content.summary",
    "integrity.created_at",
    "integrity.content_hash",
    "retention_class",
    "retention_expires_at",
    "retention_policy_version",
  ])("rejects a payload missing required field %s", (path) => {
    expect(EvidenceSchema.safeParse(omit(validPayload, path)).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum type value — Evidence.type drives which downstream reasoning step consumes the record (spec §4.6)", () => {
    const broken = { ...validPayload, type: "VIBES" };
    expect(EvidenceSchema.safeParse(broken).success).toBe(false);
  });

  it("CRITICAL: rejects an out-of-enum retention_class value — must be one of the 5 named classes (LLD-v1 §2, ADR-011), never a free string with no enforcement mechanism behind it", () => {
    const broken = { ...validPayload, retention_class: "keep_forever_i_guess" };
    expect(EvidenceSchema.safeParse(broken).success).toBe(false);
  });
});
