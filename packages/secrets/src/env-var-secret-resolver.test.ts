import { describe, expect, it } from "vitest";
import { EnvVarSecretResolver } from "./env-var-secret-resolver.js";
import { SecretNotFoundError } from "./secret-resolver.js";

describe("EnvVarSecretResolver", () => {
  it("resolves secret://NAME to the corresponding env var value", async () => {
    const resolver = new EnvVarSecretResolver({ MY_API_KEY: "sk-test-123" });
    expect(await resolver.resolve("secret://MY_API_KEY")).toBe("sk-test-123");
  });

  it("throws SecretNotFoundError when the env var is unset", async () => {
    const resolver = new EnvVarSecretResolver({});
    await expect(resolver.resolve("secret://NEVER_SET")).rejects.toThrow(SecretNotFoundError);
  });

  it("throws on a malformed secret_ref missing the secret:// prefix", async () => {
    const resolver = new EnvVarSecretResolver({ MY_API_KEY: "sk-test-123" });
    await expect(resolver.resolve("MY_API_KEY")).rejects.toThrow(/Malformed secret_ref/);
  });

  it("defaults to process.env when no env map is injected", async () => {
    process.env.AOP_TEST_SECRET_C05 = "value-from-real-process-env";
    try {
      const resolver = new EnvVarSecretResolver();
      expect(await resolver.resolve("secret://AOP_TEST_SECRET_C05")).toBe("value-from-real-process-env");
    } finally {
      delete process.env.AOP_TEST_SECRET_C05;
    }
  });
});
