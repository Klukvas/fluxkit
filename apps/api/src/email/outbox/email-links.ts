import { Inject, Injectable } from "@nestjs/common";
import type { EmailLinks, EmailRecipientKind } from "@fluxkit/core";
import { EMAIL_DELIVERY_CONFIG, type EmailDeliveryConfig } from "./email-delivery-config.js";

/** Injection token of the `EmailLinkSource` the sender renders with (a spec may provide its own). */
export const EMAIL_LINK_SOURCE = Symbol("fluxkit:email-link-source");

/** What a link may be derived from: the stored row, never a request. */
export interface EmailLinkInput {
  readonly messageId: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly recipientKind: EmailRecipientKind;
  readonly customerId: string | null;
  readonly orderId: string | null;
  /** The frozen variables (for an auth mail only the token row id). */
  readonly variables: Readonly<Record<string, unknown>>;
}

/**
 * The links of one mail, derived at render time (ADR 0031 decisions 9, 10 and 13): built from `STOREFRONT_PUBLIC_URL`, a
 * fixed path and encoded segments only. A bearer token (reset, verification, the guest order link) is derived here from
 * the stored ids and the secret, never stored. Must be deterministic: the same row gives the same links on every attempt.
 */
export interface EmailLinkSource {
  linksFor(input: EmailLinkInput): EmailLinks;
}

/** The storefront home in a locale: `<STOREFRONT_PUBLIC_URL>/<locale>`. */
export function storefrontHomeLink(base: string, locale: string): string {
  return `${base}/${encodeURIComponent(locale)}`;
}

/**
 * The link source of this step: the storefront home and no action link.
 * TODO(fluxkit): email plan steps 7 and 8 derive the action links (reset and verification tokens from the token row id,
 * the guest order link from `order_id` and `idempotency_key`, ADR 0023) and register them by template key here.
 */
@Injectable()
export class StorefrontEmailLinks implements EmailLinkSource {
  constructor(@Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig) {}

  linksFor(input: EmailLinkInput): EmailLinks {
    const base = this.config.storefrontPublicUrl;
    if (base === null) {
      throw new Error("STOREFRONT_PUBLIC_URL is needed to build the links of a mail");
    }
    return Object.freeze({ storefront: storefrontHomeLink(base, input.locale), action: null });
  }
}
