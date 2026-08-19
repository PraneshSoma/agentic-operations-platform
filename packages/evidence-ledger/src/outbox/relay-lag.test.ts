import { describe, expect, it } from "vitest";
import { DEFAULT_RELAY_LAG_THRESHOLD_MS, computeRelayLag, resolveRelayLagThresholdMs } from "./relay-lag.js";

const NOW = new Date("2026-08-18T12:10:00.000Z");

describe("resolveRelayLagThresholdMs() — configurable 5-min default, tenant-overridable (E-02, OI-LLD-02)", () => {
  it("defaults to 5 minutes when no override is given", () => {
    expect(resolveRelayLagThresholdMs()).toBe(DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(DEFAULT_RELAY_LAG_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  it("uses a positive tenant override", () => {
    expect(resolveRelayLagThresholdMs(60_000)).toBe(60_000);
  });

  it("falls back to the default for a non-positive override — never silently disables the alarm", () => {
    expect(resolveRelayLagThresholdMs(0)).toBe(DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(resolveRelayLagThresholdMs(-1)).toBe(DEFAULT_RELAY_LAG_THRESHOLD_MS);
  });
});

describe("computeRelayLag() — relay health signal (E-02)", () => {
  it("reports zero lag, not alerting, when the outbox is fully drained", () => {
    expect(computeRelayLag(undefined, NOW, DEFAULT_RELAY_LAG_THRESHOLD_MS)).toEqual({
      lag_ms: 0,
      threshold_ms: DEFAULT_RELAY_LAG_THRESHOLD_MS,
      alerting: false,
    });
  });

  it("does not alert when the oldest unpublished row is within the threshold", () => {
    const oldest = new Date(NOW.getTime() - 2 * 60 * 1000); // 2 min old, threshold 5 min
    const report = computeRelayLag(oldest, NOW, DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report.lag_ms).toBe(2 * 60 * 1000);
    expect(report.alerting).toBe(false);
  });

  it("CRITICAL: alerts when the oldest unpublished row exceeds the threshold", () => {
    const oldest = new Date(NOW.getTime() - 6 * 60 * 1000); // 6 min old, threshold 5 min
    const report = computeRelayLag(oldest, NOW, DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report.lag_ms).toBe(6 * 60 * 1000);
    expect(report.alerting).toBe(true);
  });

  it("respects a tenant-overridden (tighter) threshold", () => {
    const oldest = new Date(NOW.getTime() - 90 * 1000); // 90s old
    const report = computeRelayLag(oldest, NOW, resolveRelayLagThresholdMs(60_000)); // 60s override
    expect(report.alerting).toBe(true);
  });

  it("clamps negative lag to zero for a not-yet-eligible (future available_at) row", () => {
    const future = new Date(NOW.getTime() + 30_000);
    const report = computeRelayLag(future, NOW, DEFAULT_RELAY_LAG_THRESHOLD_MS);
    expect(report.lag_ms).toBe(0);
    expect(report.alerting).toBe(false);
  });
});
