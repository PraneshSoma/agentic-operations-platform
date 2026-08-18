import { describe, expect, it } from "vitest";
import { EnvVarSecretResolver, SecretNotFoundError } from "./index.js";

describe("@aop/secrets barrel", () => {
  it("re-exports EnvVarSecretResolver and SecretNotFoundError", () => {
    expect(new EnvVarSecretResolver({})).toBeInstanceOf(EnvVarSecretResolver);
    expect(new SecretNotFoundError("secret://x")).toBeInstanceOf(SecretNotFoundError);
  });
});
