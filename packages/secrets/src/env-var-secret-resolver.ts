import { SecretNotFoundError, type SecretResolver } from "./secret-resolver.js";

const SECRET_REF_PREFIX = "secret://";

/**
 * EnvVarSecretResolver — ADR-009's local development implementation.
 * `secretRef` convention: `secret://<ENV_VAR_NAME>` — resolves to
 * `process.env[ENV_VAR_NAME]`. No external call, no real secret manager.
 */
export class EnvVarSecretResolver implements SecretResolver {
  constructor(private readonly env: Readonly<Record<string, string | undefined>> = process.env) {}

  async resolve(secretRef: string): Promise<string> {
    if (!secretRef.startsWith(SECRET_REF_PREFIX)) {
      throw new Error(`Malformed secret_ref "${secretRef}" — expected the form "${SECRET_REF_PREFIX}<ENV_VAR_NAME>"`);
    }
    const envVarName = secretRef.slice(SECRET_REF_PREFIX.length);
    const value = this.env[envVarName];
    if (value === undefined) {
      throw new SecretNotFoundError(secretRef);
    }
    return value;
  }
}
