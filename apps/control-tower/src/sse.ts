/**
 * Server-Sent Events helpers — the wire format between the server and the
 * live UI. Pure string/object builders with no transport, so the exact
 * bytes we put on the wire are unit-testable; the Fastify route just pipes
 * these strings to the response.
 */
import type { Incident } from "./incident-store.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

export interface SnapshotMessage {
  type: "snapshot";
  scenarios: readonly Scenario[];
  incidents: Incident[];
}

export interface IncidentMessage {
  type: "incident";
  incident: Incident;
}

export type StreamMessage = SnapshotMessage | IncidentMessage;

/** The full-state message a client receives immediately on connect. */
export function snapshotMessage(incidents: Incident[]): SnapshotMessage {
  return { type: "snapshot", scenarios: SCENARIOS, incidents };
}

/** A single-incident delta pushed on every change. */
export function incidentMessage(incident: Incident): IncidentMessage {
  return { type: "incident", incident };
}

/**
 * Encodes a message as an SSE frame. Newlines inside the JSON are not
 * possible from JSON.stringify (it escapes them), so a single `data:` line
 * is always valid; the trailing blank line terminates the event.
 */
export function encodeSse(message: StreamMessage): string {
  return `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
}

/** An SSE comment line, used as a keep-alive heartbeat. */
export function heartbeat(): string {
  return `: keep-alive\n\n`;
}
