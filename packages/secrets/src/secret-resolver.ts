/**
 * SecretResolver (ADR-009, story C-05) — "Connectors code against the
 * interface only, never a concrete SDK directly" — CONTEXT.md RULE 5:
 * secrets never enter agent/LLM context; a connector resolves its own
 * `secret_ref`, uses the value directly, and never returns it.
 *
 * Env-var-backed local implementation ships now (below); the concrete
 * cloud implementation (AWS Secrets Manager, per CONTEXT.md's stated
 * default) is deferred until Tenant #1's platform is confirmed
 * (OI-CTX-08) — swapping it in later is additive configuration, not a
 * connector rewrite, because every connector already only ever sees this
 * interface.
 */
export interface SecretResolver {
  /** secretRef is an opaque reference (e.g. "secret://SOME_NAME") — never the value itself. */
  resolve(secretRef: string): Promise<string>;
}

export class SecretNotFoundError extends Error {
  constructor(public readonly secretRef: string) {
    super(`No secret found for ref "${secretRef}"`);
    this.name = "SecretNotFoundError";
  }
}
