import { describe, expect, it } from "vitest";
import { PrismaClient } from "./index.js";

describe("@aop/evidence-ledger barrel", () => {
  it("re-exports the generated PrismaClient", () => {
    expect(typeof PrismaClient).toBe("function");
  });
});
