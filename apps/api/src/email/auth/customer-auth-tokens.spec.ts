import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../../common/transaction.js";
import { AccountEmailWorld } from "../../test/account-email-world.js";
import { TEST_ORDER_TOKEN_SECRET } from "../../test/app.js";
import type { EmailDeliveryConfig, EmailOutbox } from "../outbox/index.js";
import { deriveAuthToken, hashAuthToken } from "./auth-token-crypto.js";
import {
  CustomerAuthTokenRepository,
  type FoundAuthToken,
} from "./customer-auth-token.repository.js";
import { CustomerAuthTokens } from "./customer-auth-tokens.service.js";

const NOW = new Date("2031-04-01T09:00:00.000Z");

/** A service over a repository stub that answers `row` for any hash (a lookup that went wrong). */
function serviceFinding(row: FoundAuthToken): CustomerAuthTokens {
  const repository = {
    findByHash: () => Promise.resolve(row),
  } as unknown as CustomerAuthTokenRepository;
  const outbox = { enabled: () => true } as unknown as EmailOutbox;
  const config = { tokenSecret: TEST_ORDER_TOKEN_SECRET } as unknown as EmailDeliveryConfig;
  return new CustomerAuthTokens(repository, outbox, config);
}

describe("CustomerAuthTokens.evaluate: the stored hash is checked again in constant time", () => {
  const token = deriveAuthToken(
    TEST_ORDER_TOKEN_SECRET,
    "password_reset",
    "6f1c1a52-8f3e-4a8b-9d0e-1c2b3a4d5e6f",
  );
  const row = (tokenHash: string): FoundAuthToken => ({
    id: "6f1c1a52-8f3e-4a8b-9d0e-1c2b3a4d5e6f",
    customerId: randomUUID(),
    purpose: "password_reset",
    tokenHash,
    email: "a@example.test",
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    customer: { email: "a@example.test", isActive: true, emailVerifiedAt: null },
  });

  it("accepts the row that carries the hash of the presented token", async () => {
    const result = await serviceFinding(row(hashAuthToken(token))).evaluate(
      token,
      "password_reset",
      NOW,
    );
    expect(result.decision).toEqual({ ok: true });
  });

  it("refuses a row whose stored hash is not the presented token's, as not found", async () => {
    const result = await serviceFinding(row(hashAuthToken("another token"))).evaluate(
      token,
      "password_reset",
      NOW,
    );
    expect(result.decision).toEqual({ ok: false, reason: "not_found" });
    expect(result.found).toBeUndefined();
  });

  it("does not look up a text that cannot be a token", async () => {
    const result = await serviceFinding(row(hashAuthToken("x"))).evaluate(
      "x",
      "password_reset",
      NOW,
    );
    expect(result.decision).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("CustomerAuthTokenRepository.consume (real Postgres): single use", () => {
  let world: AccountEmailWorld;

  beforeAll(async () => {
    world = await AccountEmailWorld.start();
  });

  afterAll(async () => {
    await world.stop();
  });

  async function insertToken(): Promise<{ id: string; hash: string }> {
    const shopper = await world.customer();
    const id = randomUUID();
    const hash = hashAuthToken(deriveAuthToken(TEST_ORDER_TOKEN_SECRET, "password_reset", id));
    await world.pool.query(
      `insert into customer_auth_token (id, customer_id, purpose, token_hash, email, created_at, expires_at)
       values ($1, $2, 'password_reset', $3, $4, $5, $5::timestamptz + interval '60 minutes')`,
      [id, shopper.id, hash, shopper.email, NOW],
    );
    return { id, hash };
  }

  it("answers true once, then false; a wrong hash never consumes", async () => {
    const repository = world.running.app.get(CustomerAuthTokenRepository);
    const { id, hash } = await insertToken();
    const consume = (tokenHash: string) =>
      withTransaction(world.db, (tx) => repository.consume(id, tokenHash, NOW, tx));
    expect(await consume(hashAuthToken("wrong"))).toBe(false);
    expect(await consume(hash)).toBe(true);
    expect(await consume(hash)).toBe(false);
  });

  it("lets exactly one of many concurrent consumers win (no row lock held by the callers)", async () => {
    const repository = world.running.app.get(CustomerAuthTokenRepository);
    for (let round = 0; round < 5; round += 1) {
      const { id, hash } = await insertToken();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          withTransaction(world.db, (tx) => repository.consume(id, hash, NOW, tx)),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  });
});
