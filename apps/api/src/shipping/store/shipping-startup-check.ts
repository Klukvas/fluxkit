import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { summarizeError } from "../../common/error-summary.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { ShippingProviderRegistry } from "../registry/index.js";
import { SHIPPING_STORE_LIMITS } from "./shipping-store-limits.js";
import { ShippingStoreRepository } from "./shipping-store.repository.js";

/**
 * Once at startup (review M-1): warns about ACTIVE methods that no shopper can use, so an operator notices before shoppers
 * do. Such methods are neither listed nor required by the checkout (`offeredMethods`), so they cannot lock checkouts out,
 * but the shop probably meant to offer them:
 * - a method whose provider is not loaded (`SHIPPING_PROVIDERS_ENABLED`): a `pickup_point` is not offered; an `address`
 *   method is still offered, without estimates;
 * - a method whose currency is not `SHOP_CURRENCY` (ADR 0029 decision 3: never offered).
 * The warning names method and provider codes only. A failed read never blocks startup; it is logged as a warning.
 */
@Injectable()
export class ShippingStartupCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger("ShippingStartupCheck");

  constructor(
    @Inject(ShippingStoreRepository) private readonly repository: ShippingStoreRepository,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.warn(`Could not check the active shipping methods: ${summarizeError(error)}`);
    }
  }

  /** The warnings it logged (one per problem kind), for specs. */
  async run(): Promise<string[]> {
    const rows = await this.repository.listActive(SHIPPING_STORE_LIMITS.maxMethods);
    const warnings: string[] = [];
    const unloaded = rows.filter(
      (row) => row.providerCode !== null && this.registry.get(row.providerCode) === undefined,
    );
    if (unloaded.length > 0) {
      warnings.push(
        `Active shipping methods name a provider that is not loaded (SHIPPING_PROVIDERS_ENABLED): ${unloaded
          .map((row) => `${row.code} (${row.kind}, provider ${row.providerCode ?? ""})`)
          .join(
            ", ",
          )}. Pickup point methods among them are not offered; address methods are offered without estimates.`,
      );
    }
    const foreign = rows.filter((row) => row.currency !== this.pricing.shopCurrency);
    if (foreign.length > 0) {
      warnings.push(
        `Active shipping methods are priced in another currency than SHOP_CURRENCY ${this.pricing.shopCurrency} and are not offered: ${foreign
          .map((row) => `${row.code} (${row.currency})`)
          .join(", ")}.`,
      );
    }
    for (const warning of warnings) {
      this.logger.warn(warning);
    }
    return warnings;
  }
}
