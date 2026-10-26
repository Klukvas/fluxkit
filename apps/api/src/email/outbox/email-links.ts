import { Inject, Injectable } from "@nestjs/common";
import {
  ORDER_NUMBER_PATTERN,
  type AuthTokenPurpose,
  type EmailLinks,
  type EmailRecipientKind,
} from "@fluxkit/core";
import { accessTokenMatches, deriveAccessToken } from "../../orders/access-token.js";
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
  /** May be asynchronous: the guest order link reads the order's stored data (the idempotency key) at render time. */
  linksFor(input: EmailLinkInput): EmailLinks | Promise<EmailLinks>;
}

/** Injection token of the `GuestOrderAccessSource` the order links are derived with. */
export const GUEST_ORDER_ACCESS = Symbol("fluxkit:guest-order-access");

/** What the guest order link needs from `sales_order` (ADR 0023): the two inputs of the derivation and the stored hash. */
export interface GuestOrderAccess {
  readonly idempotencyKey: string;
  readonly accessTokenHash: string | null;
}

/** Reads the stored data of one order for the guest link. Reads only; the key and the token never leave the link source. */
export interface GuestOrderAccessSource {
  find(orderId: string): Promise<GuestOrderAccess | undefined>;
}

/**
 * The link could not be derived NOW because something temporary failed (the database), not because the mail is wrong:
 * the sender does not record the mail `failed`; it stays leased and the next claim tries again (ADR 0031 decision 6).
 */
export class EmailLinkUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The mail link could not be derived right now", options);
    this.name = "EmailLinkUnavailableError";
  }
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

/** The order mails that carry a link to the order (placed, paid, shipped); the others (cancelled, expired) have none. */
export const ORDER_LINK_TEMPLATES: ReadonlySet<string> = new Set([
  "order.placed",
  "order.paid",
  "shipment.created",
]);

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

/** `<base>/<locale>/account/orders/<number>`: the customer's own order page (the session decides who may read it). */
export function accountOrderLink(base: string, locale: string, orderNumber: unknown): string {
  return `${storefrontHomeLink(base, locale)}/account/orders/${checkedOrderNumber(orderNumber)}`;
}

/** `<base>/<locale>/order/<number>#t=<token>`: the guest's order page; the bearer token stays in the fragment. */
export function guestOrderLink(
  base: string,
  locale: string,
  orderNumber: unknown,
  token: string,
): string {
  return `${storefrontHomeLink(base, locale)}/order/${checkedOrderNumber(orderNumber)}#t=${token}`;
}

function checkedOrderNumber(orderNumber: unknown): string {
  if (typeof orderNumber !== "string" || !ORDER_NUMBER_PATTERN.test(orderNumber)) {
    throw new Error("An order mail needs the order number in its variables");
  }
  return encodeURIComponent(orderNumber);
}

/**
 * The link source of the API: the storefront home in the mail's locale, the action link of the auth mails (password
 * reset, email verification) with the token derived at render time, and the order link of the order mails (ADR 0023,
 * ADR 0031 decision 13): for a guest the access token DERIVED from `ORDER_TOKEN_SECRET`, the order id and the order's
 * stored idempotency key (never stored in the outbox, checked against the order's stored hash so a dead link is never
 * sent), for a customer the account order page. A missing order, secret or number throws (the mail fails `render_failed`);
 * a failing database read throws `EmailLinkUnavailableError` (the mail is tried again).
 */
@Injectable()
export class StorefrontEmailLinks implements EmailLinkSource {
  constructor(
    @Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig,
    @Inject(GUEST_ORDER_ACCESS) private readonly orderAccess: GuestOrderAccessSource,
  ) {}

  async linksFor(input: EmailLinkInput): Promise<EmailLinks> {
    const base = this.config.storefrontPublicUrl;
    if (base === null) {
      throw new Error("STOREFRONT_PUBLIC_URL is needed to build the links of a mail");
    }
    return Object.freeze({
      storefront: storefrontHomeLink(base, input.locale),
      action: await this.actionLink(base, input),
    });
  }

  private async actionLink(base: string, input: EmailLinkInput): Promise<string | null> {
    if (Object.hasOwn(AUTH_LINK_PAGES, input.templateKey)) {
      return authActionLink(
        base,
        input.locale,
        AUTH_LINK_PAGES[input.templateKey as keyof typeof AUTH_LINK_PAGES],
        input.variables["tokenId"],
        this.config.tokenSecret,
      );
    }
    if (!ORDER_LINK_TEMPLATES.has(input.templateKey)) {
      return null;
    }
    const orderNumber = input.variables["orderNumber"];
    if (input.recipientKind === "customer") {
      // An order whose account was deleted afterwards has no page to go to.
      return input.customerId === null ? null : accountOrderLink(base, input.locale, orderNumber);
    }
    if (input.recipientKind !== "guest") {
      return null;
    }
    return this.guestLink(base, input, orderNumber);
  }

  private async guestLink(
    base: string,
    input: EmailLinkInput,
    orderNumber: unknown,
  ): Promise<string> {
    const secret = this.config.tokenSecret;
    if (secret === null) {
      throw new Error("ORDER_TOKEN_SECRET is needed to build the guest order link");
    }
    if (input.orderId === null) {
      throw new Error("A guest order mail needs its order id");
    }
    const access = await this.orderAccess.find(input.orderId);
    if (access === undefined) {
      throw new Error("The order of a guest mail does not exist");
    }
    const { token } = deriveAccessToken(secret, input.orderId, access.idempotencyKey);
    // The derivation is the one ADR 0023 stores a hash of; a different hash means the secret changed since checkout
    // (a replay under the new secret rewrote or will rewrite the hash): a link that opens nothing must not be sent.
    if (!accessTokenMatches(token, access.accessTokenHash)) {
      throw new Error("The derived guest token does not match the order's stored token hash");
    }
    return guestOrderLink(base, input.locale, orderNumber, token);
  }
}
