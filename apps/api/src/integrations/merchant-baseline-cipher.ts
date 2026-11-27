import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { integrationMerchantBaselineAad, type IntegrationKind } from "@fluxkit/core";
import { INTEGRATIONS_CONFIG, type IntegrationsConfig } from "./integrations.config.js";
import type { SealedSecret } from "./secret-cipher.js";

export interface MerchantBaselineBinding {
  readonly baselineId: string;
  readonly integrationId: string;
  readonly kind: IntegrationKind;
  readonly providerCode: string;
  readonly environment: string;
}

/** Independent AAD prevents moving a permanent merchant identity into a credential envelope. */
@Injectable()
export class MerchantBaselineCipher {
  constructor(@Inject(INTEGRATIONS_CONFIG) private readonly config: IntegrationsConfig) {}

  seal(binding: MerchantBaselineBinding, identity: string): SealedSecret {
    const key = this.config.keyRing?.current;
    const data = Buffer.from(identity, "utf8");
    if (key === undefined || data.length < 1 || data.length > 256)
      throw new Error("integration_merchant_baseline_unavailable");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
    cipher.setAAD(integrationMerchantBaselineAad({ ...binding, keyId: key.id }));
    try {
      return {
        keyId: key.id,
        nonce,
        ciphertext: Buffer.concat([cipher.update(data), cipher.final()]),
        tag: cipher.getAuthTag(),
      };
    } finally {
      data.fill(0);
    }
  }

  open(binding: MerchantBaselineBinding, sealed: SealedSecret): string {
    const ring = this.config.keyRing;
    const key =
      ring?.current.id === sealed.keyId
        ? ring.current
        : ring?.previous?.id === sealed.keyId
          ? ring.previous
          : undefined;
    if (
      key === undefined ||
      sealed.nonce.length !== 12 ||
      sealed.tag.length !== 16 ||
      sealed.ciphertext.length > 256
    )
      throw new Error("integration_merchant_baseline_unavailable");
    try {
      const cipher = createDecipheriv("aes-256-gcm", key.bytes, sealed.nonce);
      cipher.setAAD(integrationMerchantBaselineAad({ ...binding, keyId: key.id }));
      cipher.setAuthTag(sealed.tag);
      const data = Buffer.concat([cipher.update(sealed.ciphertext), cipher.final()]);
      try {
        return data.toString("utf8");
      } finally {
        data.fill(0);
      }
    } catch {
      throw new Error("integration_merchant_baseline_unavailable");
    }
  }
}
