/*
 * Managed integration credentials (ADR 0058): the pure vocabulary and rules shared by the API, the provider manifests
 * and the admin. Nothing here encrypts or reads the environment; the API owns the cipher and the store.
 */

export const INTEGRATION_KINDS = Object.freeze(["email", "payment", "shipping"] as const);
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** `outbound` authorizes calls to the provider; `webhook` verifies what the provider sends back. */
export const INTEGRATION_SECRET_PURPOSES = Object.freeze(["outbound", "webhook"] as const);
export type IntegrationSecretPurpose = (typeof INTEGRATION_SECRET_PURPOSES)[number];

/**
 * The life of one credential version. Slice 1 writes `candidate` and `retired` only; the others are reserved for
 * activation and emergency revocation, so the database check does not change when they arrive.
 */
export const INTEGRATION_CREDENTIAL_STATES = Object.freeze([
  "candidate",
  "active",
  "draining",
  "revoked",
  "retired",
] as const);
export type IntegrationCredentialState = (typeof INTEGRATION_CREDENTIAL_STATES)[number];

export const INTEGRATION_SECRET_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const INTEGRATION_ENV_VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
/** The id half of `SECRETS_ENCRYPTION_KEY` (`<id>:<base64>`); stored with every envelope. */
export const SECRETS_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
export const SECRETS_KEY_BYTES = 32;
export const INTEGRATION_SECRET_MAX_BYTES = 4096;
export const INTEGRATION_SECRET_FIELDS_MAX = 8;

const AAD_LABEL = "fluxkit.integration-secret/v1";
// Every provider credential in use is printable ASCII without spaces; anything else is a paste mistake.
const SECRET_VALUE_PATTERN = /^[\x21-\x7E]+$/;

export function isIntegrationKind(value: unknown): value is IntegrationKind {
  return typeof value === "string" && (INTEGRATION_KINDS as readonly string[]).includes(value);
}

export interface IntegrationSecretDeclaration {
  readonly field: string;
  readonly purpose: IntegrationSecretPurpose;
  /** The environment variable that overrides the stored value when it is not blank. */
  readonly envVariable: string;
}

export type IntegrationSecretDeclarationsResult =
  | { readonly ok: true; readonly fields: readonly IntegrationSecretDeclaration[] }
  | { readonly ok: false; readonly problem: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDeclaration(entry: unknown): IntegrationSecretDeclaration | string {
  if (!isRecord(entry)) return "each entry must be an object";
  const { field, purpose, env } = entry;
  if (typeof field !== "string" || !INTEGRATION_SECRET_FIELD_PATTERN.test(field)) {
    return '"field" must be lower case letters, digits and underscores, starting with a letter';
  }
  if (
    typeof purpose !== "string" ||
    !(INTEGRATION_SECRET_PURPOSES as readonly string[]).includes(purpose)
  ) {
    return `"purpose" must be one of ${INTEGRATION_SECRET_PURPOSES.join(", ")}`;
  }
  if (typeof env !== "string" || !INTEGRATION_ENV_VARIABLE_PATTERN.test(env)) {
    return '"env" must be an upper case environment variable name';
  }
  return { field, purpose: purpose as IntegrationSecretPurpose, envVariable: env };
}

/**
 * Reads `fluxkit.secrets` of a provider manifest: `[{ "field", "purpose", "env" }]`. Absent means the provider has no
 * managed secret. One version holds one purpose, so a purpose may be declared once per provider.
 */
export function parseIntegrationSecretDeclarations(
  raw: unknown,
): IntegrationSecretDeclarationsResult {
  if (raw === undefined) return { ok: true, fields: [] };
  if (!Array.isArray(raw)) return { ok: false, problem: '"fluxkit.secrets" must be an array' };
  if (raw.length > INTEGRATION_SECRET_FIELDS_MAX) {
    return {
      ok: false,
      problem: `"fluxkit.secrets" holds at most ${INTEGRATION_SECRET_FIELDS_MAX} entries`,
    };
  }
  const fields: IntegrationSecretDeclaration[] = [];
  for (const entry of raw as readonly unknown[]) {
    const parsed = parseDeclaration(entry);
    if (typeof parsed === "string") return { ok: false, problem: parsed };
    if (fields.some((known) => known.field === parsed.field)) {
      return { ok: false, problem: `the field "${parsed.field}" is declared twice` };
    }
    if (fields.some((known) => known.purpose === parsed.purpose)) {
      return { ok: false, problem: `the purpose "${parsed.purpose}" is declared twice` };
    }
    if (fields.some((known) => known.envVariable === parsed.envVariable)) {
      return { ok: false, problem: `the variable "${parsed.envVariable}" is declared twice` };
    }
    fields.push(parsed);
  }
  return { ok: true, fields: Object.freeze(fields) };
}

export type IntegrationSecretValueProblem = "required" | "too_long" | "invalid_characters";

/** The provider-independent bounds of a pasted credential; a plugin may add its own format rule on top. */
export function checkIntegrationSecretValue(value: string): IntegrationSecretValueProblem | null {
  if (value.length === 0) return "required";
  if (value.length > INTEGRATION_SECRET_MAX_BYTES) return "too_long";
  return SECRET_VALUE_PATTERN.test(value) ? null : "invalid_characters";
}

export interface IntegrationSecretIdentity {
  readonly secretId: string;
  readonly integrationId: string;
  readonly kind: IntegrationKind;
  readonly providerCode: string;
  readonly field: string;
  readonly generation: number;
  readonly keyId: string;
}

/** Every part is ASCII by construction (ids, codes, digits); anything else is a bug of the caller, not data to encode. */
function asciiBytes(part: string): Uint8Array {
  const bytes = new Uint8Array(part.length);
  for (let index = 0; index < part.length; index += 1) {
    const code = part.charCodeAt(index);
    if (code > 0x7f) throw new Error("An integration secret identity must be ASCII");
    bytes[index] = code;
  }
  return bytes;
}

function lengthPrefixed(parts: readonly string[]): Uint8Array {
  const encoded = parts.map(asciiBytes);
  const total = encoded.reduce((sum, bytes) => sum + 4 + bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.length, false);
    out.set(bytes, offset + 4);
    offset += 4 + bytes.length;
  }
  return out;
}

/**
 * The additional authenticated data of one envelope: every identity the ciphertext is bound to, each length-prefixed
 * (4 bytes, big endian) so no two different identities share an encoding. Moving a ciphertext to another row, field,
 * provider, generation or key id makes authentication fail.
 */
export function integrationSecretAad(identity: IntegrationSecretIdentity): Uint8Array {
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 1) {
    throw new Error("An integration secret generation must be a positive integer");
  }
  return lengthPrefixed([
    AAD_LABEL,
    identity.secretId,
    identity.integrationId,
    identity.kind,
    identity.providerCode,
    identity.field,
    String(identity.generation),
    identity.keyId,
  ]);
}
