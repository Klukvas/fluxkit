import type { LocalizedText } from "@fluxkit/api-client";
import { useEffect, useState } from "react";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import { loadByIds } from "../../lib/load-by-ids";
import { useCrash } from "../../lib/use-crash";

/**
 * The names of the options a product type allows (`GET /admin/options/{id}`, at most six reads at a time): the product type
 * carries option ids and codes only. A type allows a handful of options. While the reads run, or when they fail (network,
 * timeout), the map is empty and the screen shows the codes it already has; a programming error still crashes the screen.
 */
export function useOptionNames(ids: readonly string[]): ReadonlyMap<string, LocalizedText> {
  const [names, setNames] = useState<ReadonlyMap<string, LocalizedText>>(() => new Map());
  const crash = useCrash();
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    if (key === "") return undefined;
    const controller = new AbortController();
    loadByIds(key.split(","), (id) =>
      adminClient.getOption(id, { signal: controller.signal }),
    ).then(
      (found) => {
        if (controller.signal.aborted) return;
        setNames(new Map([...found].map(([id, option]) => [id, option.name])));
      },
      (error: unknown) => {
        try {
          // A lost answer leaves the codes on screen (they identify the options too).
          failureFromError(error);
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => controller.abort();
  }, [key, crash]);

  return names;
}
