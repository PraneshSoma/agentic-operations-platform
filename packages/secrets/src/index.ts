/**
 * @aop/secrets — SecretResolver interface + local env-var implementation
 * (ADR-009, story C-05). The concrete cloud secret-manager implementation
 * is deferred until Tenant #1's platform is confirmed (OI-CTX-08).
 */
export * from "./secret-resolver.js";
export * from "./env-var-secret-resolver.js";
