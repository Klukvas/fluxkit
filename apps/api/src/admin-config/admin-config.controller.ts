import { Get, Inject } from "@nestjs/common";
import { ApiOperation } from "@nestjs/swagger";
import { ALLOWED_IMAGE_TYPES, CURRENCIES, CURRENCY_CODES, exponentOf } from "@fluxkit/core";
import { AdminController } from "../auth/admin-controller.decorator.js";
import { AuthenticatedAdminRoute } from "../auth/route-access.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { ApiZodResponse } from "../common/openapi.js";
import { PRICING_CONFIG, type PricingConfig } from "../common/pricing-config.js";
import { EmailProviderRegistry } from "../email/registry/index.js";
import { PaymentProviderRegistry } from "../payments/registry/index.js";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import { SEARCH_PORT, type SearchPort } from "../common/search-port.js";
import { adminConfigResponseSchema, type AdminConfigResponse } from "./admin-config.schemas.js";

/**
 * The shop settings the admin UI needs on its own host (`/store/config` lives on the storefront's and lacks the currency
 * list and the stock threshold). Any signed-in admin may read it, whatever the role: it holds no personal data and no secret.
 */
@AdminController("config")
export class AdminConfigController {
  constructor(
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
    @Inject(MEDIA_CONFIG) private readonly media: MediaConfig,
    @Inject(EmailProviderRegistry) private readonly email: EmailProviderRegistry,
    @Inject(PaymentProviderRegistry) private readonly payments: PaymentProviderRegistry,
    @Inject(SEARCH_PORT) private readonly search: SearchPort,
  ) {}

  @Get()
  @AuthenticatedAdminRoute()
  @ApiOperation({
    summary:
      "Locales, shop currency, supported currencies, stock threshold, upload limits and whether mail, online payment and catalog search are configured, for the admin UI",
  })
  @ApiZodResponse(200, adminConfigResponseSchema, "The shop settings.")
  get(): AdminConfigResponse {
    return {
      defaultLocale: this.locale.defaultLocale,
      locales: [...this.locale.locales],
      shopCurrency: this.pricing.shopCurrency,
      currencyExponent: exponentOf(this.pricing.shopCurrency),
      supportedCurrencies: CURRENCY_CODES.map((code) => ({ code, exponent: CURRENCIES[code] })),
      pricesIncludeTax: this.pricing.pricesIncludeTax,
      lowStockThreshold: this.pricing.lowStockThreshold,
      emailDelivery: this.email.deliveryEnabled(),
      onlinePayment: this.payments.onlineEnabled(),
      search: this.search.enabled,
      media: {
        uploadsEnabled: this.media.driver !== "none",
        maxBytes: this.media.maxBytes,
        contentTypes: Object.values(ALLOWED_IMAGE_TYPES).map(({ contentType }) => contentType),
      },
    };
  }
}
