import { describe, expect, it } from "vitest";
import { IncomingRequestSchema } from "@aop/contracts";
import { normalizeWebhookRequest } from "./webhook-adapter.js";
import { InMemoryRawPayloadStore } from "./raw-payload-store.js";

describe("normalizeWebhookRequest", () => {
  it("produces a schema-valid IncomingRequest from a full webhook payload (F-01 MVP)", async () => {
    const store = new InMemoryRawPayloadStore();
    const result = await normalizeWebhookRequest({
      tenantId: "tenant_1",
      rawPayloadStore: store,
      payload: {
        source_id: "pagerduty-integration-1",
        source_reference: "PD-INC-123",
        requester: { id: "user_42", display_name: "Jane Operator", roles: ["operator"] },
        subject: "Checkout error rate spike",
        description: "Error rate above baseline for checkout-service",
        labels: { severity: "P1", application: "checkout-service", environment: "prod", category: "error-spike" },
        correlation: { incident_id: "INC-123" },
      },
    });

    expect(IncomingRequestSchema.safeParse(result).success).toBe(true);
    expect(result.source.type).toBe("webhook");
    expect(result.labels.severity).toBe("P1");
  });

  it("preserves the raw payload separately via raw_payload_ref, never inlining it into IncomingRequest", async () => {
    const store = new InMemoryRawPayloadStore();
    const rawPayload = {
      subject: "test",
      // trigger-specific noise that must never leak into the normalized shape
      x_slack_signature: "v0=deadbeef",
      pagerduty_webhook_envelope_version: "3",
    };
    const result = await normalizeWebhookRequest({ tenantId: "tenant_1", rawPayloadStore: store, payload: rawPayload });

    expect(typeof result.raw_payload_ref).toBe("string");
    expect(result.raw_payload_ref.length).toBeGreaterThan(0);

    const retrieved = await store.retrieve("tenant_1", result.raw_payload_ref);
    expect(retrieved).toEqual(rawPayload);
  });

  it("CRITICAL: no trigger-specific field is readable outside the trigger adapter — Zod strips anything not in IncomingRequestSchema", async () => {
    const store = new InMemoryRawPayloadStore();
    const result = await normalizeWebhookRequest({
      tenantId: "tenant_1",
      rawPayloadStore: store,
      payload: {
        subject: "test",
        x_slack_signature: "v0=deadbeef",
        pagerduty_webhook_envelope_version: "3",
      } as never, // deliberately widen — simulating an adapter bug that spread extra fields through
    });

    const keys = Object.keys(result).sort();
    const schemaKeys = Object.keys(IncomingRequestSchema.shape).sort();
    expect(keys).toEqual(schemaKeys);
    expect(result).not.toHaveProperty("x_slack_signature");
    expect(result).not.toHaveProperty("pagerduty_webhook_envelope_version");
  });

  it("falls back to safe defaults when optional webhook fields are absent, still producing a schema-valid request", async () => {
    const store = new InMemoryRawPayloadStore();
    const result = await normalizeWebhookRequest({ tenantId: "tenant_1", rawPayloadStore: store, payload: {} });

    expect(IncomingRequestSchema.safeParse(result).success).toBe(true);
    expect(result.requester.roles).toEqual([]);
  });

  it("scopes raw payload storage/retrieval by tenant_id — one tenant cannot read another's raw payload", async () => {
    const store = new InMemoryRawPayloadStore();
    const result = await normalizeWebhookRequest({
      tenantId: "tenant_1",
      rawPayloadStore: store,
      payload: { subject: "tenant 1's request" },
    });

    const crossTenantRead = await store.retrieve("tenant_2", result.raw_payload_ref);
    expect(crossTenantRead).toBeUndefined();
  });
});
