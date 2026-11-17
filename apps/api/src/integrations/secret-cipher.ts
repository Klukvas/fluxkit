import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretsKey, SecretsKeyRing } from "@fluxkit/config";
import {
  INTEGRATION_SECRET_MAX_BYTES,
  integrationSecretAad,
  type IntegrationSecretIdentity,
} from "@fluxkit/core";

const ALGORITHM = "aes-256-gcm";
export const SECRET_NONCE_BYTES = 12;
export const SECRET_TAG_BYTES = 16;

/** One AES-256-GCM envelope as stored: the key id names the master key, never the key itself. */
export interface SealedSecret {
  readonly keyId: string;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}

/** Everything the envelope is bound to except the key id, which the cipher chooses (seal) or reads (open). */
export type SecretBinding = Omit<IntegrationSecretIdentity, "keyId">;

/**
 * The one failure of `open`: a missing key, a wrong key, a moved or changed envelope all look the same, so nothing
 * about the reason reaches a response or a log line. Never fall back to another source when this is thrown.
 */
export class SecretUnavailableError extends Error {
  readonly code = "integration_secret_unavailable";
  constructor() {
    super("The stored integration secret cannot be read.");
    this.name = "SecretUnavailableError";
  }
}

export class SecretStorageDisabledError extends Error {
  constructor() {
    super("SECRETS_ENCRYPTION_KEY is not set.");
    this.name = "SecretStorageDisabledError";
  }
}

/**
 * Encrypts and decrypts provider credentials (ADR 0058) with `node:crypto`: AES-256-GCM, a fresh random 12-byte nonce
 * for every envelope, a 16-byte tag, and the row identity as additional authenticated data. New envelopes always use
 * the current key; the previous key only opens what it sealed until a rewrap moved it.
 */
export class SecretCipher {
  constructor(private readonly ring: SecretsKeyRing | null) {}

  get isEnabled(): boolean {
    return this.ring !== null;
  }

  /** Whether an envelope sealed under this key id can be opened by this process. */
  hasKey(keyId: string): boolean {
    return this.keyOf(keyId) !== undefined;
  }

  seal(binding: SecretBinding, plaintext: string): SealedSecret {
    if (this.ring === null) throw new SecretStorageDisabledError();
    const data = Buffer.from(plaintext, "utf8");
    if (data.length === 0 || data.length > INTEGRATION_SECRET_MAX_BYTES) {
      throw new RangeError("An integration secret must be 1 to 4096 bytes");
    }
    const key = this.ring.current;
    // Random per envelope: with 96 random bits a repeat under one key stays out of reach for this volume of writes.
    const nonce = randomBytes(SECRET_NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key.bytes, nonce, { authTagLength: SECRET_TAG_BYTES });
    cipher.setAAD(integrationSecretAad({ ...binding, keyId: key.id }));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    data.fill(0);
    return { keyId: key.id, nonce, ciphertext, tag: cipher.getAuthTag() };
  }

  open(binding: SecretBinding, sealed: SealedSecret): string {
    const key = this.keyOf(sealed.keyId);
    if (
      key === undefined ||
      sealed.nonce.length !== SECRET_NONCE_BYTES ||
      sealed.tag.length !== SECRET_TAG_BYTES
    ) {
      throw new SecretUnavailableError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key.bytes, sealed.nonce, {
        authTagLength: SECRET_TAG_BYTES,
      });
      decipher.setAAD(integrationSecretAad({ ...binding, keyId: key.id }));
      decipher.setAuthTag(sealed.tag);
      // `final` authenticates: nothing of the plaintext is returned unless the tag matches.
      const plain = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
      const text = plain.toString("utf8");
      plain.fill(0);
      return text;
    } catch {
      throw new SecretUnavailableError();
    }
  }

  private keyOf(keyId: string): SecretsKey | undefined {
    if (this.ring === null) return undefined;
    if (this.ring.current.id === keyId) return this.ring.current;
    if (this.ring.previous?.id === keyId) return this.ring.previous;
    return undefined;
  }
}
