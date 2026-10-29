import { afterAll } from "vitest";

/*
 * TEST ONLY. The no-network guard of this package (vitest `setupFiles`): every spec file runs with `globalThis.fetch`
 * wrapped so that a request to any host but 127.0.0.1 (the local stub Monobank) is refused and recorded, and the file fails
 * at the end when anything was refused, even if the plugin turned the refusal into a typed failure that a spec accepted.
 * The plugin reaches the network through `fetch` only (a static spec checks its sources import no socket module).
 */

const realFetch = globalThis.fetch;
const refused: string[] = [];

/** Hosts a spec may reach. */
const ALLOWED_HOSTS = new Set(["127.0.0.1"]);

function hostOf(input: Parameters<typeof fetch>[0]): string {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    return new URL(url).hostname;
  } catch {
    return "<unparsable>";
  }
}

const guardedFetch: typeof fetch = (input, init) => {
  const host = hostOf(input);
  if (!ALLOWED_HOSTS.has(host)) {
    refused.push(host);
    return Promise.reject(new TypeError(`no-network guard: a request to ${host} was refused`));
  }
  return realFetch(input, init);
};
// The marker `no-network-wired.spec.ts` checks without importing this module (so it sees whether the setup file ran).
Object.defineProperty(guardedFetch, Symbol.for("fluxkit.no-network-guard"), { value: true });
globalThis.fetch = guardedFetch;

/** Hosts refused so far in this spec file (a spec of the guard itself reads and clears it). */
export function refusedHosts(): string[] {
  return refused;
}

afterAll(() => {
  globalThis.fetch = realFetch;
  if (refused.length > 0) {
    const hosts = [...new Set(refused)].join(", ");
    refused.length = 0;
    throw new Error(`no-network guard: this spec file tried to reach ${hosts}`);
  }
});
