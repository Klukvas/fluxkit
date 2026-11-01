import { z } from "zod";
import { SYNONYM_LIMITS, SYNONYM_MAX_TERM_WORDS } from "@fluxkit/core";
import { paginationQuerySchema } from "../../common/pagination.js";

const timestamp = z.string().meta({ format: "date-time" });

export const adminSearchStatusSchema = z.object({
  engine: z.object({
    reachable: z.boolean().meta({
      description: "One `GET /health` of the engine with a 2 s limit answered `available`.",
    }),
    code: z.string().nullable().meta({
      description: "The error code when it did not (`engine_unreachable`, `engine_timeout`, ...).",
    }),
    rejectedSearches: z
      .object({
        count: z.number().int().min(0),
        lastCode: z.string().nullable().meta({
          description:
            "The engine's error code of the last refusal (`invalid_search_facets`, ...).",
        }),
        lastAt: z.string().nullable(),
      })
      .meta({
        description:
          "Store searches the engine refused with HTTP 400 since this API process started (a bug or a drift between the API and the live index settings; the store answered 500). Per process.",
      }),
    interactiveLane: z
      .object({
        maxConcurrency: z.number().int().min(1).meta({
          description: "`SEARCH_ENGINE_MAX_CONCURRENCY`: slots, one per engine call in flight.",
        }),
        maxQueue: z.number().int().min(0).meta({
          description: "`SEARCH_ENGINE_MAX_QUEUE`: slots that may be waited for.",
        }),
        inFlight: z.number().int().min(0).meta({ description: "Slots held now." }),
        queued: z.number().int().min(0).meta({ description: "Slots waited for now." }),
        inFlightHighWater: z.number().int().min(0).meta({
          description: "Most slots held at once since the process started.",
        }),
        queuedHighWater: z.number().int().min(0).meta({
          description: "Most slots waited for at once since the process started.",
        }),
        admitted: z.number().int().min(0).meta({
          description:
            "Admissions granted: one per search pass, suggestion or settings read (a pass takes the slots of all its parallel calls at once).",
        }),
        calls: z.number().int().min(0).meta({ description: "Engine calls sent on the lane." }),
        refused: z
          .object({
            queueFull: z.number().int().min(0),
            waitExceeded: z.number().int().min(0),
          })
          .meta({
            description:
              "Admissions refused (`engine_busy`; the store answered 503 and the storefront fell back), by reason: the queue had no room, or no slots came within 1 s.",
          }),
        abandoned: z.number().int().min(0).meta({
          description:
            "Admissions given up while they waited for slots because the shopper left (connection closed); not refusals. Added 2026-11-01.",
        }),
        since: timestamp.meta({ description: "When counting started (with the process)." }),
      })
      .meta({
        description:
          "The engine client's interactive lane (store search and suggest, ADR 0041 and 0042): limits, gauges and counters since this API process started. Per process. Refused share = refused / (admitted + refused): a share of admissions (a store search asks for up to 3, a suggestion for 1); each refusal ends one search.",
      }),
  }),
  locales: z.array(
    z.object({
      locale: z.string(),
      liveIndex: z.string().nullable(),
      documents: z
        .number()
        .int()
        .nullable()
        .meta({ description: "Documents of the live index when it was swapped in." }),
      builtAt: timestamp.nullable(),
      settingsFresh: z.boolean().meta({
        description:
          "The live index has the settings the current definitions and synonyms derive; false until job 13 applies a change.",
      }),
      documentsFresh: z.boolean().meta({
        description:
          "The live index was built for the current document version and shop currency; false means a rebuild is due.",
      }),
      rebuildRequestedAt: timestamp.nullable(),
      build: z
        .object({ index: z.string(), startedAt: timestamp, documents: z.number().int() })
        .nullable()
        .meta({
          description: "The running rebuild, if any (it is resumed every tick until the swap).",
        }),
      failedAttempts: z.number().int(),
      lastErrorCode: z.string().nullable(),
      lastErrorAt: timestamp.nullable(),
      nextAttemptAt: timestamp.nullable(),
    }),
  ),
  queue: z.object({
    depth: z.number().int().meta({ description: "Products waiting to be synced." }),
    due: z.number().int(),
    leased: z.number().int().meta({
      description: "Held by a sync that is running (or crashed: the lease ends after 2 minutes).",
    }),
    dead: z
      .number()
      .int()
      .meta({ description: "Products that failed 10 times or more; they keep retrying hourly." }),
    oldestEnqueuedAt: timestamp.nullable(),
    oldestDueAt: timestamp.nullable(),
    errorCodes: z.array(z.object({ code: z.string(), count: z.number().int() })),
  }),
});

export type AdminSearchStatus = z.output<typeof adminSearchStatusSchema>;

export const adminSearchRebuildSchema = z.object({
  requestedAt: timestamp,
  locales: z.array(z.string()),
});

export type AdminSearchRebuild = z.output<typeof adminSearchRebuildSchema>;

const termsSchema = z
  .array(z.string().max(200))
  .min(1)
  .max(SYNONYM_LIMITS.maxTerms + 1)
  .meta({
    description: `${String(SYNONYM_LIMITS.minTerms)} to ${String(SYNONYM_LIMITS.maxTerms)} distinct terms of at most ${String(SYNONYM_LIMITS.maxTermLength)} characters and ${String(SYNONYM_MAX_TERM_WORDS)} words; normalized like a search query (lower case, one apostrophe form, words joined by one space).`,
  });

export const createSynonymGroupSchema = z.strictObject({
  locale: z.string().max(35),
  terms: termsSchema,
});

export const updateSynonymGroupSchema = z.strictObject({ terms: termsSchema });

export const listSynonymGroupsQuerySchema = paginationQuerySchema.extend({
  locale: z.string().max(35).optional(),
});

export type CreateSynonymGroupBody = z.output<typeof createSynonymGroupSchema>;
export type UpdateSynonymGroupBody = z.output<typeof updateSynonymGroupSchema>;
export type ListSynonymGroupsQuery = z.output<typeof listSynonymGroupsQuerySchema>;

export const synonymGroupSchema = z.object({
  id: z.string().meta({ format: "uuid" }),
  locale: z.string(),
  terms: z.array(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export type SynonymGroupResponse = z.output<typeof synonymGroupSchema>;
