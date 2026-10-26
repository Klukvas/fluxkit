import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { salesOrder } from "../../database/schema/index.js";
import {
  EmailLinkUnavailableError,
  type GuestOrderAccess,
  type GuestOrderAccessSource,
} from "./email-links.js";

/**
 * Reads the two stored inputs of the guest order token (ADR 0023) and the stored hash of one order, at render time. One
 * primary-key read on the application pool, no transaction held while the provider is called (the sender renders before
 * it sends). Nothing here logs a value; a failing read is `EmailLinkUnavailableError` (the mail is tried again).
 */
@Injectable()
export class DatabaseGuestOrderAccess implements GuestOrderAccessSource {
  constructor(@Inject(DRIZZLE) private readonly database: Database) {}

  async find(orderId: string): Promise<GuestOrderAccess | undefined> {
    try {
      const [row] = await this.database
        .select({
          idempotencyKey: salesOrder.idempotencyKey,
          accessTokenHash: salesOrder.accessTokenHash,
        })
        .from(salesOrder)
        .where(eq(salesOrder.id, orderId));
      return row;
    } catch (error) {
      throw new EmailLinkUnavailableError({ cause: error });
    }
  }
}
