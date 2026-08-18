/**
 * @aop/identity — IdentityResolver interface + local dev-principal
 * implementation (ADR-012, story C-01). The external provider integration
 * (OIDC, workforce federation, cloud OBO) is deferred past MVP per
 * ADR-012's own decision — this package covers exactly what MVP needs.
 */
export * from "./identity-resolver.js";
export * from "./local-dev-identity-resolver.js";
