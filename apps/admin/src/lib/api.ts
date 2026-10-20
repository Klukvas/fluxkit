import { createAdminClient } from "@fluxkit/api-client";
import { withTimeout } from "./request-timeout";
import { createSignalHub, withSessionSignals } from "./session-signals";

/** 401 and 403 answers of every admin request; the session provider listens. */
export const sessionSignals = createSignalHub();

/**
 * The one admin client of the SPA. Same origin as the API (`baseUrl: ""`, ADR 0027): requests go to `/admin/*` with
 * `credentials: "same-origin"`, the client adds the CSRF header to every write and never retries. Every request has a time
 * limit (15 s reads, 30 s writes) and reports session answers to `sessionSignals`.
 */
export const adminClient = createAdminClient({
  baseUrl: "",
  fetch: withSessionSignals(
    withTimeout((url, init) => globalThis.fetch(url, init)),
    sessionSignals,
  ),
});
