import { describe, it, expect } from "vitest";
import { computeSignature, verifySlackSignature } from "./verify-signature.js";

const SECRET = "shh-signing-secret";
const BODY = "token=abc&payload=%7B%7D";
const TS = "1000000";
const NOW = 1000000;

function goodSig(): string {
  return computeSignature(SECRET, TS, BODY);
}

describe("verifySlackSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: goodSig(), timestampHeader: TS, nowSeconds: NOW });
    expect(r).toEqual({ ok: true });
  });

  it("rejects missing headers", () => {
    expect(verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: undefined, timestampHeader: TS, nowSeconds: NOW }).ok).toBe(false);
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: goodSig(), timestampHeader: undefined, nowSeconds: NOW });
    expect(r).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects a non-numeric timestamp", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: goodSig(), timestampHeader: "not-a-number", nowSeconds: NOW });
    expect(r).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a stale timestamp beyond the tolerance window", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: goodSig(), timestampHeader: TS, nowSeconds: NOW + 10_000 });
    expect(r).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("honors a custom tolerance", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: goodSig(), timestampHeader: TS, nowSeconds: NOW + 30, toleranceSeconds: 10 });
    expect(r.ok).toBe(false);
  });

  it("rejects a wrong signature", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: "v0=deadbeef", timestampHeader: TS, nowSeconds: NOW });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature computed with a different secret (length-equal, content-different)", () => {
    const forged = computeSignature("other-secret", TS, BODY);
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: forged, timestampHeader: TS, nowSeconds: NOW });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const r = verifySlackSignature({ signingSecret: SECRET, rawBody: BODY, signatureHeader: "v0=short", timestampHeader: TS, nowSeconds: NOW });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });
});
