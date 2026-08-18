import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { InMemoryRawPayloadStore } from "../triggers/raw-payload-store.js";

describe("POST /webhooks/:tenantId", () => {
  it("accepts a webhook POST and returns 202 with request_id/received_at (F-01 MVP)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/tenant_1",
      payload: { subject: "Checkout error rate spike", labels: { severity: "P1" } },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(typeof body.request_id).toBe("string");
    expect(typeof body.received_at).toBe("string");
  });

  it("does not echo the raw request body back in the response", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/tenant_1",
      payload: { subject: "test", x_webhook_signature: "should-never-appear-in-response" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.payload).not.toContain("should-never-appear-in-response");
  });

  it("preserves the raw payload in the injected RawPayloadStore, addressable only via the adapter's ref", async () => {
    const rawPayloadStore = new InMemoryRawPayloadStore();
    const app = buildApp({ rawPayloadStore });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/tenant_1",
      payload: { subject: "reconciliation needed", extra_provider_field: "opaque-value" },
    });

    const { request_id } = response.json();
    expect(typeof request_id).toBe("string");
    // The response never exposes raw_payload_ref (story scope: only
    // request_id/received_at cross the trigger endpoint boundary) — this
    // test instead proves the store actually received a call by asserting
    // the store now holds exactly one entry for this tenant.
    expect(rawPayloadStore.size("tenant_1")).toBe(1);
  });

  it("rejects an unparseable JSON body with a 400 (Fastify's own body parser)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/tenant_1",
      payload: "not valid json",
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a valid-JSON-but-non-object body (an array) with a 400 from BodySchema", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/tenant_1",
      payload: JSON.stringify(["not", "an", "object"]),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "request body must be a JSON object" });
  });
});
