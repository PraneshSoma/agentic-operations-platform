import { describe, expect, it } from "vitest";
import { CONTRACTS_PACKAGE_SCAFFOLD } from "./index.js";

describe("contracts package scaffold", () => {
  it("builds, lints, and runs end-to-end before any real contract exists", () => {
    expect(CONTRACTS_PACKAGE_SCAFFOLD).toBe(true);
  });
});
