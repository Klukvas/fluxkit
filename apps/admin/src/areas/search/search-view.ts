import type { AdminSearchStatus } from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";
import type { MessageDescriptor } from "../../lib/problem-messages";

/**
 * View models of the Search status screen (`GET /admin/search/status`, `docs/api/search.md`). Pure: the status in, what
 * the screen says out; every text is a message key of the `search` file. The engine's own wording never reaches the
 * screen: the API sends CODES only, and an unknown code is shown as it is, in small print, like the shell's problem map.
 */

/**
 * The error codes of the engine client that the status and the queue store and return: `SearchEngineErrorCode` without
 * `engine_busy` and `engine_aborted` (store search calls only, never stored; ADR 0041 and 0042). Refusals of the
 * interactive lane are counted in `engine.interactiveLane` instead (`laneView`).
 */
export const ENGINE_CODES = [
  "engine_unreachable",
  "engine_timeout",
  "engine_unauthorized",
  "engine_index_missing",
  "engine_rejected",
  "engine_unavailable",
  "engine_bad_response",
  "engine_task_failed",
  "engine_task_timeout",
] as const;

export function describeEngineCode(code: string | null): MessageDescriptor {
  if (code === null) return { key: "search.engine.code.unrecognized" };
  return (ENGINE_CODES as readonly string[]).includes(code)
    ? { key: `search.engine.code.${code}` }
    : { key: "search.engine.code.unrecognized", code };
}

export type EngineView =
  { kind: "reachable" } | { kind: "unreachable"; code: MessageDescriptor; raw: string | null };

export function engineView(
  engine: Pick<AdminSearchStatus["engine"], "reachable" | "code">,
): EngineView {
  if (engine.reachable) return { kind: "reachable" };
  return { kind: "unreachable", code: describeEngineCode(engine.code), raw: engine.code };
}

/**
 * What one locale's index is doing, most urgent first:
 * - `building`: a build runs (job 14 resumes it every tick until the swap);
 * - `never_indexed`: no live index yet (searches answer 503 and the storefront falls back to the catalog list);
 * - `rebuild_requested`: a rebuild was requested and waits for job 14;
 * - `documents_stale`: the live index was built for another document version or shop currency, a rebuild is due;
 * - `settings_pending`: only the settings are behind (synonym or definition changes), job 13 applies them in place;
 * - `fresh`.
 */
export type LocaleState =
  | "building"
  | "never_indexed"
  | "rebuild_requested"
  | "documents_stale"
  | "settings_pending"
  | "fresh";

export interface LocaleError {
  code: MessageDescriptor;
  raw: string;
  at: string | null;
  attempts: number;
  retryAt: string | null;
}

export interface LocaleView {
  locale: string;
  state: LocaleState;
  tone: StatusTone;
  liveIndex: string | null;
  documents: number | null;
  builtAt: string | null;
  rebuildRequestedAt: string | null;
  build: AdminSearchStatus["locales"][number]["build"];
  /** The last failure of the sync of this locale, whatever the state. */
  error: LocaleError | null;
}

const STATE_TONE: Record<LocaleState, StatusTone> = {
  fresh: "success",
  building: "neutral",
  rebuild_requested: "neutral",
  settings_pending: "neutral",
  never_indexed: "warning",
  documents_stale: "warning",
};

function stateOf(entry: AdminSearchStatus["locales"][number]): LocaleState {
  if (entry.build !== null) return "building";
  if (entry.liveIndex === null) return "never_indexed";
  if (entry.rebuildRequestedAt !== null) return "rebuild_requested";
  if (!entry.documentsFresh) return "documents_stale";
  if (!entry.settingsFresh) return "settings_pending";
  return "fresh";
}

export function localeView(entry: AdminSearchStatus["locales"][number]): LocaleView {
  const state = stateOf(entry);
  const error: LocaleError | null =
    entry.lastErrorCode === null
      ? null
      : {
          code: describeEngineCode(entry.lastErrorCode),
          raw: entry.lastErrorCode,
          at: entry.lastErrorAt,
          attempts: entry.failedAttempts,
          retryAt: entry.nextAttemptAt,
        };
  return {
    locale: entry.locale,
    state,
    tone: error === null ? STATE_TONE[state] : "danger",
    liveIndex: entry.liveIndex,
    documents: entry.documents,
    builtAt: entry.builtAt,
    rebuildRequestedAt: entry.rebuildRequestedAt,
    build: entry.build,
    error,
  };
}

export type QueueState = "empty" | "draining" | "attention";

export interface QueueView {
  state: QueueState;
  depth: number;
  due: number;
  leased: number;
  dead: number;
  /** How long the oldest due change has waited, in whole minutes; `null` when nothing is due. */
  lagMinutes: number | null;
  oldestEnqueuedAt: string | null;
  errorCodes: { code: MessageDescriptor; raw: string; count: number }[];
}

export function queueView(queue: AdminSearchStatus["queue"], now: Date): QueueView {
  const lagMinutes =
    queue.oldestDueAt === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - new Date(queue.oldestDueAt).getTime()) / 60_000));
  return {
    state: queue.dead > 0 ? "attention" : queue.depth > 0 ? "draining" : "empty",
    depth: queue.depth,
    due: queue.due,
    leased: queue.leased,
    dead: queue.dead,
    lagMinutes,
    oldestEnqueuedAt: queue.oldestEnqueuedAt,
    errorCodes: queue.errorCodes.map((entry) => ({
      code: describeEngineCode(entry.code),
      raw: entry.code,
      count: entry.count,
    })),
  };
}

export type RejectedView =
  | { kind: "none" }
  | { kind: "rejected"; count: number; lastCode: string | null; lastAt: string | null };

/** Searches the engine refused (a bug or a drift, not an outage), counted per API process. */
export function rejectedView(
  rejected: AdminSearchStatus["engine"]["rejectedSearches"],
): RejectedView {
  if (rejected.count === 0) return { kind: "none" };
  return {
    kind: "rejected",
    count: rejected.count,
    lastCode: rejected.lastCode,
    lastAt: rejected.lastAt,
  };
}

export interface LaneView {
  /** `refused` when the lane refused any search since the API started (the screen then shows the advice). */
  state: "clear" | "refused";
  maxConcurrency: number;
  maxQueue: number;
  inFlight: number;
  queued: number;
  inFlightHighWater: number;
  queuedHighWater: number;
  admitted: number;
  calls: number;
  /** Refusals of both reasons. */
  refused: number;
  queueFull: number;
  waitExceeded: number;
  /**
   * refused / (admitted + refused), 0 to 1: a share of ADMISSIONS (a search asks for up to 3, a suggestion for 1), while
   * each refusal is one search turned away; null before anything was asked for.
   */
  refusedShare: number | null;
  /** Given up while waiting because the shopper left: not refused, not in the share. */
  abandoned: number;
  since: string;
}

/**
 * The engine client's interactive lane (store search and suggest; ADR 0041 and 0042), counted per API process since it
 * started: how full it is now, how full it got, and how many searches it refused (each answered 503 and fell back to the
 * catalog listing).
 */
export function laneView(lane: AdminSearchStatus["engine"]["interactiveLane"]): LaneView {
  const refused = lane.refused.queueFull + lane.refused.waitExceeded;
  const asked = lane.admitted + refused;
  return {
    state: refused > 0 ? "refused" : "clear",
    maxConcurrency: lane.maxConcurrency,
    maxQueue: lane.maxQueue,
    inFlight: lane.inFlight,
    queued: lane.queued,
    inFlightHighWater: lane.inFlightHighWater,
    queuedHighWater: lane.queuedHighWater,
    admitted: lane.admitted,
    calls: lane.calls,
    refused,
    queueFull: lane.refused.queueFull,
    waitExceeded: lane.refused.waitExceeded,
    refusedShare: asked === 0 ? null : refused / asked,
    abandoned: lane.abandoned,
    since: lane.since,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago `from` was, as locale text ("5 minutes ago"). `now` is a parameter so the result is testable; a time in the
 * future (clock skew between the API and the browser) reads as "now". The Email area has the same helper; areas do not
 * import each other's code (each loads its own messages), so it is copied.
 */
export function ageText(from: string, now: Date, locale: string): string {
  const elapsed = Math.max(0, now.getTime() - new Date(from).getTime());
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed >= DAY_MS) return formatter.format(-Math.floor(elapsed / DAY_MS), "day");
  if (elapsed >= HOUR_MS) return formatter.format(-Math.floor(elapsed / HOUR_MS), "hour");
  return formatter.format(-Math.floor(elapsed / MINUTE_MS), "minute");
}

/** The part of a resource's state the screen choice needs (structural). */
export interface ResourceStatusLike {
  status: "loading" | "ready" | "error" | "forbidden" | "notFound";
}

export type SearchScreenState = { kind: "data" } | { kind: "off" } | { kind: "fallback" };

/**
 * A `404` of a search route is not a missing page: with `SEARCH_ENABLED=false` the routes are not mounted, so the screen
 * says that search is switched off and how to switch it on (`GET /admin/config` carries `search: false` too, but the
 * routes themselves are the truth for this screen). Loading, failures and "not allowed" use the shared fallbacks.
 */
export function searchScreenState(resource: ResourceStatusLike): SearchScreenState {
  switch (resource.status) {
    case "ready":
      return { kind: "data" };
    case "notFound":
      return { kind: "off" };
    default:
      return { kind: "fallback" };
  }
}
