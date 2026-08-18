import { describe, expect, it } from "vitest";
import { LocalDevIdentityResolver } from "./index.js";

describe("@aop/identity barrel", () => {
  it("re-exports LocalDevIdentityResolver", () => {
    expect(new LocalDevIdentityResolver([])).toBeInstanceOf(LocalDevIdentityResolver);
  });
});
