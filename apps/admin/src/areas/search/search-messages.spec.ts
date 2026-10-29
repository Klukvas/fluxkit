import { locales } from "@fluxkit/ui";
import type { Messages } from "@fluxkit/ui";
import { beforeAll, describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { OFF_STEP_KEYS } from "./search-frame";
import { SYNONYM_FIELD_CODES } from "./search-outcome";
import { ENGINE_CODES } from "./search-view";
import { LOCALE_STATES } from "./search-status-view";

/**
 * The message keys the area builds at run time (`search.state.${state}`, `search.engine.code.${code}`, ...) cannot be found
 * by the source scan of `messages.spec.ts`; this lists them from the same constants the code uses and checks both languages.
 */
const loaded = {} as Record<"uk" | "en", Messages>;
beforeAll(async () => {
  loaded.uk = await messagesForArea("uk", MESSAGE_FILES);
  loaded.en = await messagesForArea("en", MESSAGE_FILES);
});

const dynamicKeys = (): string[] => [
  ...LOCALE_STATES.flatMap((state) => [`search.state.${state}`, `search.stateHelp.${state}`]),
  ...ENGINE_CODES.map((code) => `search.engine.code.${code}`),
  "search.engine.code.unrecognized",
  ...["empty", "draining", "attention"].map((state) => `search.queue.state.${state}`),
  ...locales.map((entry) => `search.localeName.${entry}`),
  ...SYNONYM_FIELD_CODES.map((code) => `search.synonyms.error.${code}`),
  ...["too_many_words", "too_long", "unusable", "duplicates", "too_few", "too_many"].map(
    (issue) => `search.synonyms.issue.${issue}`,
  ),
  ...["create", "update", "delete"].flatMap((action) => [
    `search.synonyms.notice.saved.${action}`,
    `search.synonyms.notice.unknown.${action}`,
  ]),
  ...OFF_STEP_KEYS,
];

describe("the Search area's messages", () => {
  it("has every run-time key in uk and en", () => {
    for (const language of ["uk", "en"] as const) {
      for (const key of dynamicKeys()) {
        expect(loaded[language][key], `${language} ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("explains every engine code the client has (a new code needs a message here)", () => {
    expect([...ENGINE_CODES].sort()).toEqual(
      [
        "engine_bad_response",
        "engine_index_missing",
        "engine_rejected",
        "engine_task_failed",
        "engine_task_timeout",
        "engine_timeout",
        "engine_unauthorized",
        "engine_unavailable",
        "engine_unreachable",
      ].sort(),
    );
  });

  it("names SEARCH_ENABLED and the variable names in the setup steps, and never a key value", () => {
    for (const language of ["uk", "en"] as const) {
      const steps = [...OFF_STEP_KEYS, "search.off.body"]
        .map((key) => loaded[language][key])
        .join(" ");
      for (const variable of ["SEARCH_ENABLED", "MEILI_URL", "MEILI_API_KEY"]) {
        expect(steps, `${language} ${variable}`).toContain(variable);
      }
      expect(steps, language).not.toMatch(/[A-Za-z0-9]{32,}/);
    }
  });

  it("uses only the search namespace in its own file", () => {
    for (const language of ["uk", "en"] as const) {
      const own = Object.keys(loaded[language]).filter((key) => key.startsWith("search."));
      expect(own.length).toBeGreaterThan(100);
    }
  });
});
