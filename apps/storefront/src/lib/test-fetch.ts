import { createStoreClient, type StoreClient } from "@fluxkit/api-client";

/**
 * A fake `fetch` whose answers the test controls one by one, so out-of-order responses can be staged. Each call is recorded
 * and stays pending until `answer` (or `fail`) is called for it.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "English detail, never shown",
      ...extra,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

export interface PendingCall {
  method: string;
  url: string;
  body: unknown;
  headers: Headers;
  init: RequestInit;
  answer(response: Response): void;
  fail(error: unknown): void;
}

export function stagedClient(): { client: StoreClient; calls: PendingCall[] } {
  const calls: PendingCall[] = [];
  const client = createStoreClient({
    baseUrl: "",
    fetch: (url, init) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({
          method: String(init.method),
          url,
          body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
          headers: new Headers(init.headers),
          init,
          answer: resolve,
          fail: reject,
        });
      }),
  });
  return { client, calls };
}

/** A client that answers every call at once with `handler`; the calls are recorded. */
export function immediateClient(handler: (call: Omit<PendingCall, "answer" | "fail">) => Response) {
  const calls: Omit<PendingCall, "answer" | "fail">[] = [];
  const client = createStoreClient({
    baseUrl: "",
    fetch: async (url, init) => {
      const call = {
        method: String(init.method),
        url,
        body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init.headers),
        init,
      };
      calls.push(call);
      return handler(call);
    },
  });
  return { client, calls };
}

/** Lets pending promise callbacks run. */
export function settle(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}
