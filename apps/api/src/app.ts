import Fastify, { type FastifyInstance } from "fastify";
import type { IdentityResolver } from "@aop/identity";
import { LocalDevIdentityResolver } from "@aop/identity";
import type { ActionConnector } from "@aop/action-executor";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerStatusCheckRoutes } from "./routes/status-check.js";
import { InMemoryRawPayloadStore, type RawPayloadStore } from "./triggers/raw-payload-store.js";
import { InMemoryApprovalContextStore, type ApprovalContextStore } from "./approvals/approval-context-store.js";

export interface BuildAppOptions {
  rawPayloadStore?: RawPayloadStore;
  approvalContextStore?: ApprovalContextStore;
  identityResolver?: IdentityResolver;
  /** connector_ref -> ActionConnector, backing POST /internal/connectors/{connector_ref}/status-check (D-07). */
  connectorRegistry?: ReadonlyMap<string, ActionConnector>;
  logger?: boolean;
}

/**
 * App factory — never calls `.listen()` itself, so tests can exercise
 * routes via Fastify's `.inject()` without binding a real port. src/index.ts
 * is the only place that calls `.listen()`.
 *
 * Validation is plain Zod `.safeParse()` inside each route handler
 * (CONTEXT.md RULE 1 — "Runtime input ... MUST be parsed through the
 * schema at the boundary"), not a Fastify type-provider plugin: the only
 * published `@fastify/type-provider-zod` requires zod v4 + fastify v5,
 * and every contract in this repo is already built and ACCEPTED against
 * zod v3 — not worth a breaking-version cascade for one route package.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  const rawPayloadStore = options.rawPayloadStore ?? new InMemoryRawPayloadStore();
  const approvalContextStore = options.approvalContextStore ?? new InMemoryApprovalContextStore();
  // Empty by default — a real deployment injects its actual tenant
  // principal list; local dev/tests inject their own fixtures.
  const identityResolver = options.identityResolver ?? new LocalDevIdentityResolver([]);
  const connectorRegistry = options.connectorRegistry ?? new Map<string, ActionConnector>();

  app.register(async (instance) => {
    await registerWebhookRoutes(instance, { rawPayloadStore });
    await registerApprovalRoutes(instance, { approvalContextStore, identityResolver });
    await registerStatusCheckRoutes(instance, { connectorRegistry });
  });

  return app;
}
