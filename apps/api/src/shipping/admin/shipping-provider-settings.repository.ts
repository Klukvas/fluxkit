import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { shippingProviderSetting } from "../../database/schema/index.js";

export type ProviderSettingRow = typeof shippingProviderSetting.$inferSelect;

/** Queries only. One row per provider code; secrets never reach this table. */
@Injectable()
export class ShippingProviderSettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(providerCode: string): Promise<ProviderSettingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(shippingProviderSetting)
      .where(eq(shippingProviderSetting.providerCode, providerCode));
    return row;
  }

  /** Creates or replaces the row of the provider, recording who saved it. One statement, so two saves cannot interleave. */
  async upsert(
    providerCode: string,
    settings: Record<string, unknown>,
    updatedBy: string,
  ): Promise<ProviderSettingRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(shippingProviderSetting)
      .values({ providerCode, settings, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        target: shippingProviderSetting.providerCode,
        // The query builder's $onUpdate does not apply to an upsert, so the time is set here.
        set: { settings, updatedAt: now, updatedBy },
      })
      .returning();
    if (row === undefined) {
      throw new Error("The database returned no row for a statement that must return one.");
    }
    return row;
  }
}
