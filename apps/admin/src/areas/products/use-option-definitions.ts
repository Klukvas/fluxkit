import type { AdminOptionWithValues, LocalizedText } from "@fluxkit/api-client";
import { useCallback, useEffect, useState } from "react";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import { loadByIds } from "../../lib/load-by-ids";
import { useCrash } from "../../lib/use-crash";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";

export interface OptionDefinitions {
  /** By option id; an option the API did not answer (deleted meanwhile) is missing and shows its code. */
  byId: ReadonlyMap<string, AdminOptionWithValues>;
  status: "loading" | "ready" | "failed";
  retry: () => void;
}

/**
 * The names and values of options (`GET /admin/options/{id}`, one read per option, at most six at a time; the product
 * detail and the product type carry ids and codes only, and no product-level read of option values exists). A product
 * uses at most three options; its type allows a handful. A lost answer leaves the codes on screen and offers a retry;
 * nothing retries by itself.
 */
export function useOptionDefinitions(ids: readonly string[]): OptionDefinitions {
  const [byId, setById] = useState<ReadonlyMap<string, AdminOptionWithValues>>(() => new Map());
  const [status, setStatus] = useState<OptionDefinitions["status"]>(
    ids.length === 0 ? "ready" : "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const crash = useCrash();
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    if (key === "") {
      setStatus("ready");
      return undefined;
    }
    const controller = new AbortController();
    setStatus("loading");
    loadByIds(key.split(","), (id) =>
      adminClient.getOption(id, { signal: controller.signal }),
    ).then(
      (found) => {
        if (controller.signal.aborted) return;
        setById(found);
        setStatus("ready");
      },
      (error: unknown) => {
        try {
          if (failureFromError(error) !== null) setStatus("failed");
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => controller.abort();
  }, [key, attempt, crash]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { byId, status, retry };
}

/** The values of an option in the option's order (position, then code). */
export function definitionValueIds(definition: AdminOptionWithValues | undefined): string[] {
  if (definition === undefined) return [];
  return [...definition.values]
    .sort((left, right) => left.position - right.position || left.code.localeCompare(right.code))
    .map((value) => value.id);
}

/** An option's name in the UI language with fallback, else its code. */
export function optionName(
  definition: AdminOptionWithValues | undefined,
  code: string,
  uiLocale: string,
  defaultLocale: string,
): string {
  return resolveLocalized(definition?.name, uiLocale, defaultLocale) || code;
}

/** A value's label in the UI language with fallback, else its code (or the given fallback). */
export function valueLabel(
  definition: AdminOptionWithValues | undefined,
  valueId: string,
  fallback: string,
  uiLocale: string,
  defaultLocale: string,
): string {
  const label: LocalizedText | undefined = definition?.values.find(
    (value) => value.id === valueId,
  )?.label;
  const code = definition?.values.find((value) => value.id === valueId)?.code;
  return resolveLocalized(label, uiLocale, defaultLocale) || code || fallback;
}
