/*
 * The master keys that encrypt provider credentials stored in the database (ADR 0058). `SECRETS_ENCRYPTION_KEY` is
 * `<key-id>:<base64>`: the id is stored with every envelope, the value is the canonical standard Base64 of exactly 32
 * random bytes (`openssl rand -base64 32`). `SECRETS_ENCRYPTION_KEY_PREVIOUS` has the same form and is the key being
 * rotated out. A problem names the rule, never any part of the value.
 */

export const SECRETS_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
export const SECRETS_KEY_BYTES = 32;

const CANONICAL_BASE64_OF_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

export interface SecretsKey {
  readonly id: string;
  readonly bytes: Uint8Array;
}

/** `null` when neither variable is set: credentials then come from the environment only. */
export interface SecretsKeyRing {
  readonly current: SecretsKey;
  readonly previous: SecretsKey | null;
}

export type SecretsKeyResult =
  | { readonly ok: true; readonly key: SecretsKey }
  | { readonly ok: false; readonly problem: string };

const FORMAT_PROBLEM =
  "must be <key-id>:<base64> where the id is 1 to 32 letters, digits, _ or - and the value is the standard Base64 of exactly 32 random bytes (the value is not shown)";

export function parseSecretsKeyVariable(raw: string): SecretsKeyResult {
  const separator = raw.indexOf(":");
  if (separator < 1) {
    return { ok: false, problem: FORMAT_PROBLEM };
  }
  const id = raw.slice(0, separator);
  const encoded = raw.slice(separator + 1);
  if (!SECRETS_KEY_ID_PATTERN.test(id) || !CANONICAL_BASE64_OF_32_BYTES.test(encoded)) {
    return { ok: false, problem: FORMAT_PROBLEM };
  }
  const bytes = Buffer.from(encoded, "base64");
  // Only the canonical encoding is accepted: stray bits in the last character would make two spellings of one key.
  if (bytes.length !== SECRETS_KEY_BYTES || bytes.toString("base64") !== encoded) {
    return { ok: false, problem: FORMAT_PROBLEM };
  }
  return { ok: true, key: { id, bytes: new Uint8Array(bytes) } };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The rule two keys of one ring break, or `undefined`: they need different ids and different bytes. */
export function secretsKeyPairProblem(
  current: SecretsKey,
  previous: SecretsKey,
): string | undefined {
  if (current.id === previous.id) {
    return "must have a different key id than SECRETS_ENCRYPTION_KEY";
  }
  if (sameBytes(current.bytes, previous.bytes)) {
    return "must be a different key than SECRETS_ENCRYPTION_KEY";
  }
  return undefined;
}
