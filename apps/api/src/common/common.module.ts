import { Global, Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { LOCALE_CONFIG, type LocaleConfig } from "./locale.js";
import { ProblemDetailsFilter } from "./problem.filter.js";

/** Global: the problem filter for every route, and the locale configuration for services. */
@Global()
@Module({})
export class CommonModule {
  static register(locale: LocaleConfig): DynamicModule {
    return {
      module: CommonModule,
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: LOCALE_CONFIG, useValue: locale },
      ],
      exports: [LOCALE_CONFIG],
    };
  }
}
