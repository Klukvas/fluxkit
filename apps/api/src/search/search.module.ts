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
import { SEARCH_PORT, type SearchPort } from "../common/search-port.js";
import { SearchEngine } from "./engine/index.js";
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
    const providers: Provider[] = [
      { provide: SEARCH_CONFIG, useValue: config },
      {
        provide: SEARCH_ENGINE,
        useValue: config.enabled
          ? new SearchEngine({
              url: config.meiliUrl,
              apiKey: config.meiliApiKey,
              requestTimeoutMs: config.tuning.requestTimeoutMs,
            })
          : null,
      },
      {
        provide: SEARCH_PORT,
        useValue: { enabled: config.enabled } satisfies SearchPort,
      },
      SearchStartupLog,
    ];
    return {
      module: SearchModule,
      providers,
      exports: [SEARCH_CONFIG, SEARCH_ENGINE, SEARCH_PORT],
    };
  }
}
