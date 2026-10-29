import {
  decideIndexAction,
  deriveIndexSettings,
  parseSynonymTerms,
  searchRebuildKey,
  SEARCH_DOCUMENT_VERSION,
} from "@fluxkit/core";
import { asc, count, eq, type SQL } from "drizzle-orm";
import type { LocaleConfig } from "../../common/locale.js";
import { toPage, type Page } from "../../common/pagination.js";
import type { PricingConfig } from "../../common/pricing-config.js";
import { notFound, validationFailed } from "../../common/problem.js";
import type { Database } from "../../database/database.module.js";
import { searchSynonymGroup } from "../../database/schema/index.js";
import { SearchEngineError, type SearchEngine } from "../engine/index.js";
import { readSearchDefinitions, SearchIndexStateRepository } from "../indexer/index.js";
import { SearchQueueRepository } from "../queue/search-queue.repository.js";
import type { SearchConfig } from "../search-config.js";
import type {
  AdminSearchRebuild,
  AdminSearchStatus,
  CreateSynonymGroupBody,
  ListSynonymGroupsQuery,
  SynonymGroupResponse,
  UpdateSynonymGroupBody,
} from "./admin-search.schemas.js";

type SynonymRow = typeof searchSynonymGroup.$inferSelect;

function toSynonymResponse(row: SynonymRow): SynonymGroupResponse {
  return {
    id: row.id,
    locale: row.locale,
    terms: row.terms,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/**
 * The admin side of search (ADR 0034 decisions 8 and 10): the status of every locale's index and of the queue, a rebuild
 * request, and the synonym groups (applied by job 13 as an in-place settings update: no rebuild). Mounted only with
 * `SEARCH_ENABLED=true`. Codes only, never an engine message.
 */
export class AdminSearchService {
  private readonly states = new SearchIndexStateRepository();

  private readonly queue = new SearchQueueRepository();

  constructor(
    private readonly database: Database,
    private readonly engine: SearchEngine,
    private readonly config: Extract<SearchConfig, { enabled: true }>,
    private readonly locale: LocaleConfig,
    private readonly pricing: PricingConfig,
  ) {}

  async status(now: Date): Promise<AdminSearchStatus> {
    let reachable = true;
    let code: string | null = null;
    try {
      await this.engine.health(this.config.tuning.healthTimeoutMs);
    } catch (error) {
      if (!(error instanceof SearchEngineError)) {
        throw error;
      }
      reachable = false;
      code = error.code;
    }
    const states = await this.states.loadAll(this.database);
    const definitions = await readSearchDefinitions(this.database);
    const locales: AdminSearchStatus["locales"] = [];
    for (const locale of this.locale.locales) {
      const state = states.get(locale);
      const synonyms = await this.database
        .select({ terms: searchSynonymGroup.terms })
        .from(searchSynonymGroup)
        .where(eq(searchSynonymGroup.locale, locale))
        .orderBy(asc(searchSynonymGroup.createdAt), asc(searchSynonymGroup.id));
      const derived = deriveIndexSettings({
        locale,
        currency: this.pricing.shopCurrency,
        options: definitions.typeOptionCodes,
        attributes: definitions.allAssignments,
        synonymGroups: synonyms.map((row) => row.terms),
      });
      const action = decideIndexAction({ locale, state: state ?? null, derived, now });
      locales.push({
        locale,
        liveIndex: state?.liveIndexUid ?? null,
        documents: state?.documentsCount ?? null,
        builtAt: iso(state?.builtAt ?? null),
        settingsFresh: state?.liveIndexUid != null && state.settingsHash === derived.settingsHash,
        documentsFresh:
          state?.documentVersion != null &&
          state.currency !== null &&
          searchRebuildKey(state.documentVersion, state.currency, locale) ===
            searchRebuildKey(SEARCH_DOCUMENT_VERSION, this.pricing.shopCurrency, locale) &&
          action.kind !== "rebuild",
        rebuildRequestedAt: iso(state?.rebuildRequestedAt ?? null),
        build:
          state?.buildIndexUid != null && state.buildStartedAt !== null
            ? {
                index: state.buildIndexUid,
                startedAt: state.buildStartedAt.toISOString(),
                documents: state.buildDocumentsCount,
              }
            : null,
        failedAttempts: state?.failedAttempts ?? 0,
        lastErrorCode: state?.lastErrorCode ?? null,
        lastErrorAt: iso(state?.lastErrorAt ?? null),
        nextAttemptAt: iso(state?.nextAttemptAt ?? null),
      });
    }
    const summary = await this.queue.summary(this.database, now);
    return {
      engine: { reachable, code },
      locales,
      queue: {
        depth: summary.depth,
        due: summary.due,
        leased: summary.leased,
        dead: summary.dead,
        oldestEnqueuedAt: iso(summary.oldestEnqueuedAt),
        oldestDueAt: iso(summary.oldestDueAt),
        errorCodes: [...summary.errorCodes],
      },
    };
  }

  /** Idempotent: a request while a build runs is kept and answered by another build after that one swaps. */
  async requestRebuild(now: Date): Promise<AdminSearchRebuild> {
    await this.states.requestRebuild(this.database, this.locale.locales, now);
    return { requestedAt: now.toISOString(), locales: [...this.locale.locales] };
  }

  async listSynonyms(query: ListSynonymGroupsQuery): Promise<Page<SynonymGroupResponse>> {
    if (query.locale !== undefined) {
      this.assertLocale(query.locale);
    }
    const where: SQL | undefined =
      query.locale === undefined ? undefined : eq(searchSynonymGroup.locale, query.locale);
    const rows = await this.database
      .select()
      .from(searchSynonymGroup)
      .where(where)
      .orderBy(
        asc(searchSynonymGroup.locale),
        asc(searchSynonymGroup.createdAt),
        asc(searchSynonymGroup.id),
      )
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await this.database
      .select({ value: count() })
      .from(searchSynonymGroup)
      .where(where);
    return toPage(rows.map(toSynonymResponse), total?.value ?? 0, query);
  }

  async createSynonyms(
    body: CreateSynonymGroupBody,
    adminId: string | null,
  ): Promise<SynonymGroupResponse> {
    this.assertLocale(body.locale);
    const terms = this.terms(body.terms);
    const [row] = await this.database
      .insert(searchSynonymGroup)
      .values({ locale: body.locale, terms, createdByAdminId: adminId })
      .returning();
    if (row === undefined) {
      throw new Error("An inserted synonym group was not returned.");
    }
    return toSynonymResponse(row);
  }

  async updateSynonyms(id: string, body: UpdateSynonymGroupBody): Promise<SynonymGroupResponse> {
    const terms = this.terms(body.terms);
    const [row] = await this.database
      .update(searchSynonymGroup)
      .set({ terms, updatedAt: new Date() })
      .where(eq(searchSynonymGroup.id, id))
      .returning();
    if (row === undefined) {
      throw notFound("Synonym group");
    }
    return toSynonymResponse(row);
  }

  async deleteSynonyms(id: string): Promise<void> {
    const deleted = await this.database
      .delete(searchSynonymGroup)
      .where(eq(searchSynonymGroup.id, id))
      .returning({ id: searchSynonymGroup.id });
    if (deleted.length === 0) {
      throw notFound("Synonym group");
    }
  }

  private terms(raw: readonly string[]): string[] {
    const parsed = parseSynonymTerms(raw);
    if (!parsed.ok) {
      throw validationFailed([{ path: "terms", code: parsed.reason }]);
    }
    return [...parsed.terms];
  }

  private assertLocale(locale: string): void {
    if (!this.locale.locales.includes(locale)) {
      throw validationFailed([
        {
          path: "locale",
          code: "invalid_value",
          message: `Must be one of: ${this.locale.locales.join(", ")}.`,
        },
      ]);
    }
  }
}
