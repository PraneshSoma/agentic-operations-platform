/**
 * Outbox relay-lag alerting (story E-02, OI-LLD-02, folded in here per
 * LLD-v1 §8's correction — "ship with a configurable default alert
 * threshold (5 minutes, tenant-overridable) rather than leaving the
 * number unspecified"). Pure — no I/O, no clock of its own — so the
 * threshold resolution and lag decision are unit-testable in isolation.
 *
 * "Relay lag" is how long the OLDEST still-unpublished outbox row has
 * been eligible for pickup (`available_at`) without being published. A
 * healthy relay keeps that near zero; a stalled or overwhelmed relay lets
 * it grow, which is the signal ADR-005's Consequences call out as needing
 * its own health metric (spec §29).
 */
export const DEFAULT_RELAY_LAG_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes (OI-LLD-02)

/**
 * Resolves the effective lag threshold: a tenant override when provided
 * and positive, otherwise the 5-minute default. A non-positive or absent
 * override falls back to the default rather than disabling alerting —
 * "never silently turn the alarm off."
 */
export function resolveRelayLagThresholdMs(tenantOverrideMs?: number): number {
  return tenantOverrideMs !== undefined && tenantOverrideMs > 0 ? tenantOverrideMs : DEFAULT_RELAY_LAG_THRESHOLD_MS;
}

export interface RelayLagReport {
  lag_ms: number;
  threshold_ms: number;
  alerting: boolean;
}

/**
 * Computes the current relay-lag report. `oldestUnpublishedAvailableAt`
 * is the `available_at` of the oldest still-unpublished row, or undefined
 * when the outbox is fully drained (lag 0, never alerting).
 */
export function computeRelayLag(oldestUnpublishedAvailableAt: Date | undefined, now: Date, thresholdMs: number): RelayLagReport {
  if (oldestUnpublishedAvailableAt === undefined) {
    return { lag_ms: 0, threshold_ms: thresholdMs, alerting: false };
  }
  // An event not yet eligible (available_at in the future) contributes no
  // lag — clamp negative lag to zero.
  const lag_ms = Math.max(0, now.getTime() - oldestUnpublishedAvailableAt.getTime());
  return { lag_ms, threshold_ms: thresholdMs, alerting: lag_ms > thresholdMs };
}
