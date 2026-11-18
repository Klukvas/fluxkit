import { afterAll } from "vitest";

const realFetch = globalThis.fetch;
const refused: string[] = [];

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
Object.defineProperty(guardedFetch, Symbol.for("fluxkit.no-network-guard"), { value: true });
globalThis.fetch = guardedFetch;

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
