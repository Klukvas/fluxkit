import { createAdminClient, createTransport, type FetchLike } from "@fluxkit/api-client";
import { withTimeout } from "./request-timeout";
import { createSignalHub, withSessionSignals } from "./session-signals";

/** 401 and 403 answers of every admin request; the session provider listens. */
export const sessionSignals = createSignalHub();

/** Every admin request: a time limit (15 s reads, 30 s writes) and the session answers reported to `sessionSignals`. */
const adminFetch: FetchLike = withSessionSignals(
  withTimeout((url, init) => globalThis.fetch(url, init)),
  sessionSignals,
);

/**
 * The one admin client of the SPA. Same origin as the API (`baseUrl: ""`, ADR 0027): requests go to `/admin/*` with
 * `credentials: "same-origin"`, the client adds the CSRF header to every write and never retries.
 */
export const adminClient = createAdminClient({ baseUrl: "", fetch: adminFetch });

/**
 * The same transport for the routes of an optional feature (`src/features/<name>/`, ADR 0049), which are not in the
 * client's operation table: a feature slice describes its own operations (`TransportOperation`) and gets the same CSRF
 * header, time limits, session signals and problem parsing as every other admin request.
 */
export const adminFeatureTransport = createTransport({ baseUrl: "", fetch: adminFetch });
