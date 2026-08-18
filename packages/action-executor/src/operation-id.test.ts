import { describe, expect, it } from "vitest";
import { deriveOperationId } from "./operation-id.js";

describe("deriveOperationId() — deterministic, stable across attempts (LLD-v1 §2)", () => {
  it("CRITICAL: is byte-identical when called twice with identical input", () => {
    const a = deriveOperationId("tenant_1", "exec_1", "step_1", "1.0.0");
    const b = deriveOperationId("tenant_1", "exec_1", "step_1", "1.0.0");
    expect(a).toBe(b);
  });

  it("differs when any one input differs", () => {
    const base = deriveOperationId("tenant_1", "exec_1", "step_1", "1.0.0");
    expect(deriveOperationId("tenant_2", "exec_1", "step_1", "1.0.0")).not.toBe(base);
    expect(deriveOperationId("tenant_1", "exec_2", "step_1", "1.0.0")).not.toBe(base);
    expect(deriveOperationId("tenant_1", "exec_1", "step_2", "1.0.0")).not.toBe(base);
    expect(deriveOperationId("tenant_1", "exec_1", "step_1", "2.0.0")).not.toBe(base);
  });

  it("is prefixed with op_ for readability/observability", () => {
    expect(deriveOperationId("tenant_1", "exec_1", "step_1", "1.0.0")).toMatch(/^op_[0-9a-f]{64}$/);
  });
});
