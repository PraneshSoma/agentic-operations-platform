import Fastify, { type FastifyInstance } from "fastify";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { InMemoryRawPayloadStore, type RawPayloadStore } from "./triggers/raw-payload-store.js";

export interface BuildAppOptions {
  rawPayloadStore?: RawPayloadStore;
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

  app.register(async (instance) => {
    await registerWebhookRoutes(instance, { rawPayloadStore });
  });

  return app;
}
