import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  authTokenExpiresAt,
  evaluateAuthToken,
  isCustomerAuthTokenFormat,
  validateEmailAddress,
  type AuthTokenDecision,
  type AuthTokenPurpose,
} from "@fluxkit/core";
import type { Transaction } from "../../common/transaction.js";
import { EMAIL_DELIVERY_CONFIG, EmailOutbox, type EmailDeliveryConfig } from "../outbox/index.js";
import { authTokenHashesMatch, deriveAuthToken, hashAuthToken } from "./auth-token-crypto.js";
import {
  CustomerAuthTokenRepository,
  type FoundAuthToken,
} from "./customer-auth-token.repository.js";

/** The mail each purpose sends (ADR 0031 decision 14, core `EMAIL_TEMPLATE_KEYS`). */
export const AUTH_TOKEN_TEMPLATE_KEYS = Object.freeze({
  password_reset: "customer.password_reset",
  email_verification: "customer.verify_email",
} as const satisfies Record<AuthTokenPurpose, string>);

/** The customer a token is issued to, read under the caller's row lock (`SELECT ... FOR UPDATE`). */
export interface AuthTokenRecipient {
  readonly id: string;
  /** `customer.email`, normalized. The token is bound to it and the mail goes to it. */
  readonly email: string;
}

export type IssueAuthTokenResult =
  /** The token row and its mail (variables `{tokenId}` only) are written in the caller's transaction. */
  | { readonly status: "issued"; readonly tokenId: string; readonly messageId: string }
  /** `EMAIL_PROVIDER=none`: nothing written. */
  | { readonly status: "disabled" }
  /** The address cannot go into a mail header (core `validateEmailAddress`, e.g. non-ASCII): nothing written. */
  | { readonly status: "undeliverable" };

/** What a presented token turned out to be: the decision of core, and the row when one was found. */
export interface PresentedAuthToken {
  readonly decision: AuthTokenDecision;
  /** `undefined` when the text is not a token, or no row carries its hash. */
  readonly found: FoundAuthToken | undefined;
  /** SHA-256 of the presented token (what `consume` must still find on the row). */
  readonly tokenHash: string;
}

/**
 * Customer password reset and email verification tokens (ADR 0031 decision 9). A token is DERIVED from the random id of
 * its row and `ORDER_TOKEN_SECRET` under its own label (core `deriveCustomerAuthToken`); the row stores only SHA-256 of
 * it, the outbox only `{tokenId}`, and the link source derives it again while rendering. Rules are core's
 * (`authTokenExpiresAt`, `evaluateAuthToken`); this class adds the database, the hashing and the outbox.
 *
 * Callers hold the customer row lock (`SELECT ... FOR UPDATE`) around `issue` and `consume`, so two requests of one
 * customer serialize instead of colliding on the "one unused token per customer and purpose" index.
 */
@Injectable()
export class CustomerAuthTokens {
  constructor(
    @Inject(CustomerAuthTokenRepository) private readonly tokens: CustomerAuthTokenRepository,
    @Inject(EmailOutbox) private readonly outbox: EmailOutbox,
    @Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig,
  ) {}

  /** Whether tokens can be mailed at all (`EMAIL_PROVIDER` is not `none`). */
  enabled(): boolean {
    return this.outbox.enabled();
  }

  /**
   * Issues a token of `purpose` to `recipient` inside `tx` (the caller holds the customer's row lock): earlier unused
   * tokens of the purpose are marked used, the new row is inserted with the hash of its derived token, and the mail is
   * enqueued with `{tokenId}` and the token's expiry as its deadline base. Nothing is written without a provider or for
   * an address no mail header can carry.
   */
  async issue(
    tx: Transaction,
    input: {
      readonly recipient: AuthTokenRecipient;
      readonly purpose: AuthTokenPurpose;
      readonly locale: string;
      readonly now: Date;
    },
  ): Promise<IssueAuthTokenResult> {
    if (!this.outbox.enabled()) {
      return { status: "disabled" };
    }
    if (!validateEmailAddress(input.recipient.email).ok) {
      return { status: "undeliverable" };
    }
    const tokenId = randomUUID();
    const token = deriveAuthToken(this.secret(), input.purpose, tokenId);
    const expiresAt = authTokenExpiresAt(input.purpose, input.now);
    await this.tokens.invalidateUnused(input.recipient.id, input.purpose, input.now, tx);
    await this.tokens.insert(
      {
        id: tokenId,
        customerId: input.recipient.id,
        purpose: input.purpose,
        tokenHash: hashAuthToken(token),
        email: input.recipient.email,
        createdAt: input.now,
        expiresAt,
      },
      tx,
    );
    const enqueued = await this.outbox.enqueue(tx, {
      templateKey: AUTH_TOKEN_TEMPLATE_KEYS[input.purpose],
      locale: input.locale,
      to: input.recipient.email,
      recipientKind: "customer",
      customerId: input.recipient.id,
      variables: { tokenId },
      authTokenExpiresAt: expiresAt,
      now: input.now,
    });
    if (enqueued.status !== "enqueued") {
      // Delivery and the address were checked above and an auth mail has no dedupe key: anything else is a bug.
      throw new Error(`An auth token mail was not enqueued: ${enqueued.status}`);
    }
    return { status: "issued", tokenId, messageId: enqueued.id };
  }

  /** Tokens of `purpose` issued to the customer strictly after `since` (the database limit spans instances). */
  countIssuedSince(
    tx: Transaction,
    customerId: string,
    purpose: AuthTokenPurpose,
    since: Date,
  ): Promise<number> {
    return this.tokens.countCreatedSince(customerId, purpose, since, tx);
  }

  /**
   * Looks the presented text up (by the hash index, then a constant-time check of the stored hash) and asks core whether
   * it may be used for `purpose` now. Pass `tx` to read inside the caller's transaction (after its row lock).
   */
  async evaluate(
    presented: unknown,
    purpose: AuthTokenPurpose,
    now: Date,
    tx?: Transaction,
  ): Promise<PresentedAuthToken> {
    const tokenHash = hashAuthToken(typeof presented === "string" ? presented : "");
    const candidate = isCustomerAuthTokenFormat(presented)
      ? await this.tokens.findByHash(tokenHash, tx)
      : undefined;
    const found =
      candidate !== undefined && authTokenHashesMatch(tokenHash, candidate.tokenHash)
        ? candidate
        : undefined;
    const decision = evaluateAuthToken({
      token:
        found === undefined
          ? null
          : {
              purpose: found.purpose,
              email: found.email,
              expiresAt: found.expiresAt,
              usedAt: found.usedAt,
            },
      customer:
        found === undefined
          ? null
          : { email: found.customer.email, isActive: found.customer.isActive },
      purpose,
      now,
    });
    return { decision, found, tokenHash };
  }

  /** Single use: true for exactly one caller, while the row is unused and still carries `tokenHash`. */
  consume(tx: Transaction, tokenId: string, tokenHash: string, now: Date): Promise<boolean> {
    return this.tokens.consume(tokenId, tokenHash, now, tx);
  }

  /** Marks the customer's unused tokens used (all purposes, or one): password change, deactivation, a reset. */
  invalidate(
    tx: Transaction,
    customerId: string,
    purpose: AuthTokenPurpose | undefined,
    now: Date,
  ): Promise<number> {
    return this.tokens.invalidateUnused(customerId, purpose, now, tx);
  }

  private secret(): string {
    const secret = this.config.tokenSecret;
    if (secret === null) {
      // main.ts refuses to start without ORDER_TOKEN_SECRET; only a caller that built the app without it lands here.
      throw new Error("ORDER_TOKEN_SECRET is needed to issue a customer auth token");
    }
    return secret;
  }
}
