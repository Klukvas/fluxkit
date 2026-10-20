import type { AdminResult } from "@fluxkit/api-client";

/** At most this many requests in flight when a screen needs several reads (plan, "Performance"). */
export const MAX_IN_FLIGHT = 6;

/**
 * Reads one resource per distinct id (the brand names of a product list page, the categories of a product), at most six
 * at a time. An id the API does not answer with data (deleted meanwhile, no permission) is left out of the map; nothing is
 * retried. A thrown error (network, timeout, abort) rejects the whole load.
 */
export async function loadByIds<T>(
  ids: readonly string[],
  read: (id: string) => Promise<AdminResult<T>>,
): Promise<Map<string, T>> {
  const distinct = [...new Set(ids)];
  const found = new Map<string, T>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < distinct.length) {
      const id = distinct[next] as string;
      next += 1;
      const result = await read(id);
      if (result.ok) found.set(id, result.data);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, distinct.length) }, worker));
  return found;
}
