import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { LOCALE_CONFIG, type LocaleConfig } from "./locale.js";
import { PRICING_CONFIG, type PricingConfig } from "./pricing-config.js";
import { ProblemDetailsFilter } from "./problem.filter.js";

/** Global: the problem filter for every route, and the locale and pricing configuration for services. */
@Global()
@Module({})
export class CommonModule {
  static register(locale: LocaleConfig, pricing: PricingConfig): DynamicModule {
    return {
      module: CommonModule,
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: LOCALE_CONFIG, useValue: locale },
        { provide: PRICING_CONFIG, useValue: pricing },
      ],
      exports: [LOCALE_CONFIG, PRICING_CONFIG],
    };
  }
}
