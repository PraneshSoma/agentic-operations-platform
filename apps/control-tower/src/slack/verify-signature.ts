/**
 * Slack request-signature verification (pure).
 *
 * Slack signs every request to our endpoints with an HMAC-SHA256 over
 * `v0:{timestamp}:{rawBody}` keyed by the app's signing secret, and sends
 * the result as `X-Slack-Signature: v0=...` alongside
 * `X-Slack-Request-Timestamp`. Verifying it is the ONLY thing that proves a
 * request actually came from Slack and not a forged POST to our public
 * callback URL — so interactivity (the Approve/Reject buttons) must not be
 * honored unless this passes.
 *
 * This module is pure: it takes the raw body, headers, secret, and current
 * time, and returns a verdict. No framework, no clock of its own — the
 * route supplies `nowSeconds` — so every branch is unit-testable.
 *
 * See https://api.slack.com/authentication/verifying-requests-from-slack.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyInput {
  signingSecret: string;
  /** The exact raw request body bytes, as a string. */
  rawBody: string;
  /** X-Slack-Signature header, e.g. "v0=abc123…". */
  signatureHeader: string | undefined;
  /** X-Slack-Request-Timestamp header (unix seconds, as a string). */
  timestampHeader: string | undefined;
  /** Current time in unix seconds — injected so tests are deterministic. */
  nowSeconds: number;
  /** Reject requests older than this many seconds (replay window). */
  toleranceSeconds?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" };

const DEFAULT_TOLERANCE_SECONDS = 60 * 5;

export function computeSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifySlackSignature(input: VerifyInput): VerifyResult {
  const { signingSecret, rawBody, signatureHeader, timestampHeader, nowSeconds } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = computeSignature(signingSecret, timestampHeader, rawBody);
  if (!safeEqual(expected, signatureHeader)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}
