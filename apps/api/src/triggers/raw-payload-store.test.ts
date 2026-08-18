import { describe, expect, it } from "vitest";
import { InMemoryRawPayloadStore } from "./raw-payload-store.js";

describe("InMemoryRawPayloadStore", () => {
  it("stores and retrieves a payload by the ref it returns", async () => {
    const store = new InMemoryRawPayloadStore();
    const ref = await store.store("tenant_1", { hello: "world" });
    expect(await store.retrieve("tenant_1", ref)).toEqual({ hello: "world" });
  });

  it("returns undefined for an unknown ref", async () => {
    const store = new InMemoryRawPayloadStore();
    expect(await store.retrieve("tenant_1", "nonexistent")).toBeUndefined();
  });

  it("returns undefined when the ref exists but under a different tenant_id (RULE 4)", async () => {
    const store = new InMemoryRawPayloadStore();
    const ref = await store.store("tenant_1", { secret: "tenant 1 data" });
    expect(await store.retrieve("tenant_2", ref)).toBeUndefined();
  });

  it("generates distinct refs for repeated stores under the same tenant", async () => {
    const store = new InMemoryRawPayloadStore();
    const ref1 = await store.store("tenant_1", { n: 1 });
    const ref2 = await store.store("tenant_1", { n: 2 });
    expect(ref1).not.toBe(ref2);
    expect(await store.retrieve("tenant_1", ref1)).toEqual({ n: 1 });
    expect(await store.retrieve("tenant_1", ref2)).toEqual({ n: 2 });
  });

  it("size() returns 0 for a tenant with no stored payloads", async () => {
    const store = new InMemoryRawPayloadStore();
    expect(store.size("tenant_never_used")).toBe(0);
  });

  it("size() counts only the given tenant's payloads", async () => {
    const store = new InMemoryRawPayloadStore();
    await store.store("tenant_1", { a: 1 });
    await store.store("tenant_1", { a: 2 });
    await store.store("tenant_2", { a: 3 });
    expect(store.size("tenant_1")).toBe(2);
    expect(store.size("tenant_2")).toBe(1);
  });
});
