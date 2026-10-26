import { Inject, Injectable } from "@nestjs/common";
import type { AuthTokenPurpose, EmailLinks, EmailRecipientKind } from "@fluxkit/core";
import { deriveAuthToken } from "../auth/auth-token-crypto.js";
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
 * The storefront page each auth mail links to, and the purpose its token was issued for. The token travels in the URL
 * FRAGMENT (`#t=`): never in access logs, a `Referer` or the Next.js server (ADR 0031 decision 13, as ADR 0023).
 */
export const AUTH_LINK_PAGES = Object.freeze({
  "customer.password_reset": { purpose: "password_reset", path: "account/reset-password" },
  "customer.verify_email": { purpose: "email_verification", path: "account/verify-email" },
} as const satisfies Record<string, { purpose: AuthTokenPurpose; path: string }>);

const TOKEN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `<base>/<locale>/<page>#t=<token>` for an auth mail. The token is derived from the row id of `variables.tokenId` and the
 * secret (core `deriveCustomerAuthToken`, its 43 characters need no encoding). A missing secret or token id is a bug or a
 * misconfiguration: it throws, and the sender records the mail `failed` `render_failed`.
 */
export function authActionLink(
  base: string,
  locale: string,
  page: (typeof AUTH_LINK_PAGES)[keyof typeof AUTH_LINK_PAGES],
  tokenId: unknown,
  secret: string | null,
): string {
  if (secret === null) {
    throw new Error("ORDER_TOKEN_SECRET is needed to build the link of an auth mail");
  }
  if (typeof tokenId !== "string" || !TOKEN_ID.test(tokenId)) {
    throw new Error("An auth mail needs the token row id in its variables");
  }
  const token = deriveAuthToken(secret, page.purpose, tokenId);
  return `${storefrontHomeLink(base, locale)}/${page.path}#t=${token}`;
}

/**
 * The link source of the API: the storefront home in the mail's locale, and the action link of the auth mails
 * (password reset, email verification) with the token derived at render time.
 * TODO(fluxkit): email plan step 8 adds the order links (the guest order link from `order_id` and `idempotency_key`,
 * ADR 0023; the account order link) by template key here.
 */
@Injectable()
export class StorefrontEmailLinks implements EmailLinkSource {
  constructor(@Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig) {}

  linksFor(input: EmailLinkInput): EmailLinks {
    const base = this.config.storefrontPublicUrl;
    if (base === null) {
      throw new Error("STOREFRONT_PUBLIC_URL is needed to build the links of a mail");
    }
    const page = Object.hasOwn(AUTH_LINK_PAGES, input.templateKey)
      ? AUTH_LINK_PAGES[input.templateKey as keyof typeof AUTH_LINK_PAGES]
      : undefined;
    return Object.freeze({
      storefront: storefrontHomeLink(base, input.locale),
      action:
        page === undefined
          ? null
          : authActionLink(
              base,
              input.locale,
              page,
              input.variables["tokenId"],
              this.config.tokenSecret,
            ),
    });
  }
}
