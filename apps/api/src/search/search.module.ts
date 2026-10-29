import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type Provider,
} from "@nestjs/common";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { PRICING_CONFIG, type PricingConfig } from "../common/pricing-config.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { SearchIndexer } from "./indexer/index.js";
import { DISABLED_SEARCH_PORT, SEARCH_PORT, type SearchPort } from "../common/search-port.js";
import { SearchEngine } from "./engine/index.js";
import { SearchQueue } from "./queue/search-queue.js";
import { SEARCH_CONFIG, searchStartupLine, type SearchConfig } from "./search-config.js";

/** The engine client, or null with `SEARCH_ENABLED=false` (no client is created and nothing connects). */
export const SEARCH_ENGINE = Symbol("SEARCH_ENGINE");

/** Logs `Search: disabled` or `Search: enabled (<prefix>)` once the app starts (no URL, no key, no network call). */
@Injectable()
class SearchStartupLog implements OnApplicationBootstrap {
  constructor(@Inject(SEARCH_CONFIG) private readonly config: SearchConfig) {}

  onApplicationBootstrap(): void {
    new Logger("Search").log(searchStartupLine(this.config));
  }
}

/**
 * Catalog search (ADR 0034). Global so that the catalog, price, stock and order modules can inject `SEARCH_PORT` without
 * importing anything from this folder. With search off the port reports `enabled: false` and nothing else is mounted.
 */
@Global()
@Module({})
export class SearchModule {
  static register(config: SearchConfig): DynamicModule {
    const engine = config.enabled
      ? new SearchEngine({
          url: config.meiliUrl,
          apiKey: config.meiliApiKey,
          requestTimeoutMs: config.tuning.requestTimeoutMs,
        })
      : null;
    const providers: Provider[] = [
      { provide: SEARCH_CONFIG, useValue: config },
      { provide: SEARCH_ENGINE, useValue: engine },
      {
        // With search off the port is the no-op one: no statement ever reaches the search tables.
        provide: SEARCH_PORT,
        inject: [LOCALE_CONFIG],
        useFactory: (locale: LocaleConfig): SearchPort =>
          config.enabled
            ? new SearchQueue({
                locales: locale.locales,
                fanOutRebuildThreshold: config.tuning.fanOutRebuildThreshold,
              })
            : DISABLED_SEARCH_PORT,
      },
      {
        // Jobs 13 and 14. With search off it answers `enabled: false` and reads nothing.
        provide: SearchIndexer,
        inject: [DRIZZLE, SEARCH_ENGINE, LOCALE_CONFIG, PRICING_CONFIG],
        useFactory: (
          database: Database,
          engine: SearchEngine | null,
          locale: LocaleConfig,
          pricing: PricingConfig,
        ) => new SearchIndexer(database, engine, config, locale, pricing),
      },
      SearchStartupLog,
    ];
    return {
      module: SearchModule,
      providers,
      exports: [SEARCH_CONFIG, SEARCH_ENGINE, SEARCH_PORT, SearchIndexer],
    };
  }
}
