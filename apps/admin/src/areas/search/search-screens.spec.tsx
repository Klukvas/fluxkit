import type { AdminSearchStatus, AdminSynonymGroup } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { Messages } from "@fluxkit/ui";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { SearchNav, SearchOffView } from "./search-frame";
import { RebuildNoticeView, RebuildPanel, StatusView } from "./search-status-view";
import { DeleteSynonymDialog, SynonymFormDialog } from "./synonym-dialogs";
import { parseTermsInput } from "./synonym-terms";
import {
  SynonymApplyNote,
  SynonymNoticeView,
  SynonymResultsView,
  type SynonymListState,
} from "./synonyms-view";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const NOW = new Date("2026-10-29T12:00:00.000Z");

function locale(
  overrides: Partial<AdminSearchStatus["locales"][number]> = {},
): AdminSearchStatus["locales"][number] {
  return {
    locale: "uk",
    liveIndex: "fluxkit_catalog_uk_1",
    documents: 120,
    builtAt: "2026-10-29T10:00:00.000Z",
    settingsFresh: true,
    documentsFresh: true,
    rebuildRequestedAt: null,
    build: null,
    failedAttempts: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

type Lane = AdminSearchStatus["engine"]["interactiveLane"];

/** A fresh process's interactive lane: nothing admitted, refused or held. */
const IDLE_LANE: Lane = {
  maxConcurrency: 8,
  maxQueue: 512,
  inFlight: 0,
  queued: 0,
  inFlightHighWater: 0,
  queuedHighWater: 0,
  admitted: 0,
  calls: 0,
  refused: { queueFull: 0, waitExceeded: 0 },
  since: "2026-10-29T08:00:00.000Z",
};

/** A lane under overload: full now, and a quarter of the searches refused since the start. */
const REFUSING_LANE: Lane = {
  ...IDLE_LANE,
  inFlight: 8,
  queued: 30,
  inFlightHighWater: 8,
  queuedHighWater: 512,
  admitted: 300,
  calls: 900,
  refused: { queueFull: 60, waitExceeded: 40 },
};

function status(overrides: Partial<AdminSearchStatus> = {}): AdminSearchStatus {
  return {
    engine: {
      reachable: true,
      code: null,
      rejectedSearches: { count: 0, lastCode: null, lastAt: null },
      interactiveLane: IDLE_LANE,
    },
    locales: [locale(), locale({ locale: "en", liveIndex: "fluxkit_catalog_en_1" })],
    queue: {
      depth: 0,
      due: 0,
      leased: 0,
      dead: 0,
      oldestEnqueuedAt: null,
      oldestDueAt: null,
      errorCodes: [],
    },
    ...overrides,
  };
}

function panel(overrides: { canManage?: boolean; busy?: boolean; confirming?: boolean } = {}) {
  return (
    <RebuildPanel
      t={sentinel}
      uiLocale="en"
      canManage={overrides.canManage ?? true}
      busy={overrides.busy ?? false}
      notice={{ kind: "idle" }}
      confirming={overrides.confirming ?? false}
      onAsk={noop}
      onCancel={noop}
      onConfirm={noop}
    />
  );
}

function statusHtml(data: AdminSearchStatus, rebuild = panel()) {
  return renderInRouter(
    <StatusView t={sentinel} uiLocale="en" status={data} now={NOW} rebuild={rebuild} />,
  );
}

/** Text that is data, not words of the UI: removed before the check for hardcoded text. */
function withoutData(html: string): string {
  return [
    "fluxkit_catalog_uk_1",
    "fluxkit_catalog_en_1",
    "engine_unreachable",
    "engine_timeout",
    "engine_task_timeout",
    "invalid_search_facets",
    "odd_code",
  ].reduce((text, word) => text.split(word).join(" "), html);
}

function group(overrides: Partial<AdminSynonymGroup> = {}): AdminSynonymGroup {
  return {
    id: "6f1d8b46-0a8e-4e0a-9d5e-3b8c2a1f9a10",
    locale: "uk",
    terms: ["викрутка", "відвертка"],
    createdAt: "2026-10-29T09:00:00.000Z",
    updatedAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

function list(
  state: SynonymListState,
  options: { canManage?: boolean; offset?: number; locale?: string } = {},
) {
  return renderInRouter(
    <SynonymResultsView
      t={sentinel}
      uiLocale="en"
      query={{ locale: options.locale ?? "", limit: 50, offset: options.offset ?? 0 }}
      state={state}
      canManage={options.canManage ?? true}
      onRetry={noop}
      onEdit={noop}
      onDelete={noop}
      hrefForOffset={(offset) => `/catalog/search/synonyms?offset=${String(offset)}`}
    />,
  );
}

describe("the status screen", () => {
  it("shows every state of an index in words, never as colour alone", () => {
    const states: [Partial<AdminSearchStatus["locales"][number]>, string][] = [
      [{}, "fresh"],
      [{ liveIndex: null, documents: null, builtAt: null, documentsFresh: false }, "never_indexed"],
      [
        { build: { index: "x_2", startedAt: "2026-10-29T11:59:00.000Z", documents: 5 } },
        "building",
      ],
      [{ rebuildRequestedAt: "2026-10-29T11:00:00.000Z" }, "rebuild_requested"],
      [{ documentsFresh: false }, "documents_stale"],
      [{ settingsFresh: false }, "settings_pending"],
    ];
    for (const [overrides, state] of states) {
      const html = statusHtml(status({ locales: [locale(overrides)] }));
      expect(html, state).toContain(`§search.state.${state}`);
      expect(html, state).toContain(`§search.stateHelp.${state}`);
    }
  });

  it("shows no text that is not a message (sentinel check) for the busiest status", () => {
    const html = statusHtml(
      status({
        engine: {
          reachable: false,
          code: "engine_unreachable",
          rejectedSearches: {
            count: 3,
            lastCode: "invalid_search_facets",
            lastAt: "2026-10-29T11:00:00.000Z",
          },
          interactiveLane: REFUSING_LANE,
        },
        locales: [
          locale({
            lastErrorCode: "engine_task_timeout",
            lastErrorAt: "2026-10-29T11:30:00.000Z",
            failedAttempts: 2,
            nextAttemptAt: "2026-10-29T12:10:00.000Z",
            rebuildRequestedAt: "2026-10-29T11:00:00.000Z",
            build: { index: "x_2", startedAt: "2026-10-29T11:59:00.000Z", documents: 5 },
          }),
        ],
        queue: {
          depth: 4,
          due: 3,
          leased: 1,
          dead: 2,
          oldestEnqueuedAt: "2026-10-29T11:00:00.000Z",
          oldestDueAt: "2026-10-29T11:30:00.000Z",
          errorCodes: [
            { code: "engine_timeout", count: 2 },
            { code: "odd_code", count: 1 },
          ],
        },
      }),
    );
    expect(leftoverText(withoutData(html))).toBe("");
    expect(textAttributes(html).filter((value) => !value.startsWith("§"))).toEqual([]);
  });

  it("says the engine does not answer with the explanation and the raw code, never an engine message", () => {
    const html = statusHtml(
      status({
        engine: {
          reachable: false,
          code: "engine_timeout",
          rejectedSearches: { count: 0, lastCode: null, lastAt: null },
          interactiveLane: IDLE_LANE,
        },
      }),
    );
    expect(html).toContain("§search.engine.unreachable");
    expect(html).toContain("§search.engine.code.engine_timeout");
    expect(html).toContain("engine_timeout");
  });

  it("shows the refused searches with the engine's last code, or says there are none", () => {
    const rejected = statusHtml(
      status({
        engine: {
          reachable: true,
          code: null,
          rejectedSearches: {
            count: 2,
            lastCode: "invalid_search_facets",
            lastAt: "2026-10-29T11:00:00.000Z",
          },
          interactiveLane: IDLE_LANE,
        },
      }),
    );
    expect(rejected).toContain("§search.rejected.title");
    expect(rejected).toContain("invalid_search_facets");
    expect(statusHtml(status())).toContain("§search.rejected.none");
  });

  it("shows the interactive lane's numbers as per process, and a warning with the advice once it refused searches", () => {
    const quiet = statusHtml(status());
    expect(quiet).toContain('aria-labelledby="search-lane"');
    expect(quiet).toContain("§search.lane.title");
    expect(quiet).toContain("§search.lane.intro");
    expect(quiet).toContain("§search.lane.noneRefused");
    expect(quiet).not.toContain("§search.lane.refusedTitle");
    for (const key of [
      "inFlight",
      "queued",
      "peaks",
      "admitted",
      "calls",
      "refusedQueueFull",
      "refusedWaitExceeded",
    ]) {
      expect(quiet, key).toContain(`§search.lane.${key}`);
    }
    const refusing = statusHtml(
      status({
        engine: { ...status().engine, interactiveLane: REFUSING_LANE },
      }),
    );
    expect(refusing).toContain("§search.lane.refusedTitle");
    expect(refusing).toContain("§search.lane.refusedBody");
    expect(refusing).toContain("§search.lane.advice");
    expect(refusing).not.toContain("§search.lane.noneRefused");
  });

  it("shows the queue numbers and the empty states, and the failing products as attention", () => {
    const quiet = statusHtml(status());
    expect(quiet).toContain("§search.queue.state.empty");
    expect(quiet).toContain("§search.queue.noErrorsTitle");
    expect(quiet).toContain("§search.queue.nothingDue");
    const busy = statusHtml(
      status({
        queue: {
          depth: 12,
          due: 5,
          leased: 1,
          dead: 3,
          oldestEnqueuedAt: "2026-10-29T11:00:00.000Z",
          oldestDueAt: "2026-10-29T11:30:00.000Z",
          errorCodes: [{ code: "engine_timeout", count: 3 }],
        },
      }),
    );
    expect(busy).toContain("§search.queue.state.attention");
    expect(busy).toContain("§search.queue.lag");
    expect(busy).toContain("<caption");
    expect(busy).toContain("§search.queue.errorsCaption");
    expect(busy).toContain("<dd");
    expect(busy).toContain(">12<");
  });

  it("gives every index its own headed section", () => {
    const html = statusHtml(status());
    expect(html).toContain('aria-labelledby="search-locale-uk"');
    expect(html).toContain('aria-labelledby="search-locale-en"');
    expect(html).toContain('id="search-locale-uk"');
    expect(html).toContain("§search.localeName.uk");
  });
});

describe("the rebuild panel", () => {
  const askButton = (html: string) =>
    /<button[^>]*>§search\.rebuild\.button<\/button>/.exec(html)?.[0] ?? "";

  it("offers the button to an admin who may change the catalog; the dialog is closed", () => {
    const html = renderInRouter(panel());
    expect(askButton(html)).not.toBe("");
    expect(html).toContain("§search.rebuild.confirmTitle");
  });

  it("renders no write control for a viewer, and says why", () => {
    const html = renderInRouter(panel({ canManage: false }));
    expect(html).not.toContain("§search.rebuild.button");
    expect(html).toContain("§search.rebuild.readOnly");
  });

  it("disables the button while the request runs", () => {
    expect(renderInRouter(panel({ busy: true }))).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"/,
    );
  });

  it("asks first: the confirmation is an alertdialog with the safe choice focused and both buttons off while busy", () => {
    const html = renderInRouter(panel({ confirming: true }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toMatch(/<button[^>]*data-autofocus=""[^>]*>§search\.rebuild\.cancel<\/button>/);
    expect(html).toContain("§search.rebuild.confirm");
    const busy = renderInRouter(panel({ confirming: true, busy: true }));
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>§search\.rebuild\.cancel<\/button>/);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>§search\.rebuild\.confirm<\/button>/);
  });

  it("words the outcomes honestly: requested is not finished, a lost answer is unknown", () => {
    const html = (notice: Parameters<typeof RebuildNoticeView>[0]["notice"]) =>
      renderToStaticMarkup(<RebuildNoticeView t={sentinel} uiLocale="en" notice={notice} />);
    const requested = html({
      kind: "requested",
      requestedAt: "2026-10-29T12:00:00.000Z",
      locales: ["uk", "en"],
    });
    expect(requested).toContain("§search.rebuild.requested");
    expect(requested).toContain("§search.rebuild.requestedNote");
    expect(html({ kind: "unknown" })).toContain("§search.rebuild.unknownBody");
    expect(html({ kind: "off" })).toContain("§search.rebuild.off");
    expect(html({ kind: "forbidden" })).toContain("§search.rebuild.forbidden");
    expect(
      html({ kind: "refused", descriptor: { key: "errors.code.too_many_requests" } }),
    ).toContain("§errors.code.too_many_requests");
    expect(html({ kind: "idle" })).toBe("");
  });
});

describe("the switched-off state", () => {
  it("says search is switched off, names SEARCH_ENABLED and only variable names, never a key", () => {
    const html = renderToStaticMarkup(<SearchOffView t={sentinel} />);
    expect(html).toContain("§search.off.title");
    for (const step of ["step1", "step2", "step3"]) expect(html).toContain(`§search.off.${step}`);
    expect(leftoverText(html)).toBe("");
  });

  it("has the area's sub-navigation with the current screen marked", () => {
    const html = renderInRouter(<SearchNav t={sentinel} current="searchSynonyms" />);
    expect(html).toContain('href="/admin-ui/catalog/search"');
    expect(html).toContain('href="/admin-ui/catalog/search/synonyms"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});

describe("the synonym list", () => {
  const ready = (items: AdminSynonymGroup[], total = items.length): SynonymListState => ({
    status: "ready",
    data: { items, total, limit: 50, offset: 0 },
  });

  it("lists the groups in an accessible table with the terms and the language", () => {
    const html = list(ready([group()]));
    expect(html).toContain("<caption");
    expect(html).toContain("викрутка, відвертка");
    expect(html).toContain("§search.localeName.uk");
  });

  it("offers edit and delete (named by the terms) only to an admin who may change the catalog", () => {
    const writer = list(ready([group()]), { canManage: true });
    expect(writer).toContain("§search.synonyms.edit");
    expect(writer).toContain("§search.synonyms.delete");
    expect(writer).toContain('aria-label="§search.synonyms.editLabel"');
    const viewer = list(ready([group()]), { canManage: false });
    expect(viewer).not.toContain("§search.synonyms.edit");
    expect(viewer).not.toContain("§search.synonyms.delete");
    expect(viewer).not.toContain("<button");
    expect(viewer).toContain("викрутка, відвертка");
  });

  it("shows the loading, empty (with or without a language), failure and past-the-end states", () => {
    expect(list({ status: "loading" })).toContain('aria-busy="true"');
    expect(list(ready([]))).toContain("§search.synonyms.emptyBody");
    expect(list(ready([]), { locale: "en" })).toContain("§search.synonyms.emptyLocaleBody");
    const failed = list({ status: "error", failure: { kind: "network" } });
    expect(failed).toContain("§errors.network");
    expect(failed).toContain("§action.retry");
    expect(list({ status: "forbidden" })).toContain("§error.forbiddenData");
    const past = list(ready([]), { offset: 100 });
    expect(past).toContain("§search.synonyms.pastEnd");
    expect(past).toContain('href="/admin-ui/catalog/search/synonyms?offset=0"');
  });

  it("pages with links when there are more groups than one page", () => {
    const html = list(
      { status: "ready", data: { items: [group()], total: 120, limit: 50, offset: 50 } },
      { offset: 50 },
    );
    expect(html).toContain("§search.synonyms.pageRange");
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain("offset=0");
    expect(html).toContain("offset=100");
  });

  it("says that a change applies on the next sync, with the queue number and the waiting languages", () => {
    const data = status({
      locales: [locale({ settingsFresh: false }), locale({ locale: "en" })],
      queue: { ...status().queue, depth: 7 },
    });
    const html = renderInRouter(
      <SynonymApplyNote t={sentinel} uiLocale="en" queue={data.queue} locales={data.locales} />,
    );
    expect(html).toContain("§search.synonyms.applyNote");
    expect(html).toContain("§search.synonyms.queueNow");
    expect(html).toContain("§search.synonyms.settingsPending");
    expect(html).toContain('href="/admin-ui/catalog/search"');
    const none = renderInRouter(
      <SynonymApplyNote
        t={sentinel}
        uiLocale="en"
        queue={status().queue}
        locales={status().locales}
      />,
    );
    expect(none).not.toContain("§search.synonyms.settingsPending");
  });

  it("words the notices after a write, including a lost answer", () => {
    const html = (notice: Parameters<typeof SynonymNoticeView>[0]["notice"]) =>
      renderToStaticMarkup(<SynonymNoticeView t={sentinel} notice={notice} />);
    expect(html({ kind: "saved", action: "create" })).toContain(
      "§search.synonyms.notice.saved.create",
    );
    expect(html({ kind: "saved", action: "delete" })).toContain(
      "§search.synonyms.notice.appliesLater",
    );
    expect(html({ kind: "unknown", action: "update" })).toContain(
      "§search.synonyms.notice.unknown.update",
    );
    expect(html({ kind: "gone" })).toContain("§search.synonyms.notice.gone");
    expect(html({ kind: "unchanged" })).toContain("§search.synonyms.notice.unchanged");
    expect(html({ kind: "none" })).toBe("");
  });
});

describe("the synonym dialogs", () => {
  function form(overrides: Partial<Parameters<typeof SynonymFormDialog>[0]> = {}) {
    return renderToStaticMarkup(
      <SynonymFormDialog
        t={sentinel}
        open
        mode="create"
        locales={["uk", "en"]}
        locale="uk"
        onLocaleChange={noop}
        text=""
        onTextChange={noop}
        parsed={parseTermsInput("")}
        showIssues={false}
        fieldErrors={null}
        error={null}
        busy={false}
        onSubmit={noop}
        onClose={noop}
        {...overrides}
      />,
    );
  }

  it("labels every field, marks the terms required and links the hint", () => {
    const html = form();
    expect(html).toMatch(/<label[^>]*for="search-synonym-locale"/);
    expect(html).toMatch(/<label[^>]*for="search-synonym-terms"/);
    expect(html).toMatch(
      /<textarea[^>]*id="search-synonym-terms"[^>]*aria-describedby="search-synonym-terms-hint"/,
    );
    expect(html).toContain('method="post"');
  });

  it("shows nothing wrong before the first send attempt, then the issues on the terms field", () => {
    const parsed = parseTermsInput("shirt, long sleeve cotton top");
    expect(form({ parsed })).not.toContain("§search.synonyms.issue.too_many_words");
    const html = form({ parsed, showIssues: true });
    expect(html).toContain("§search.synonyms.issue.too_many_words");
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(html).toMatch(
      /<textarea[^>]*aria-describedby="search-synonym-terms-hint search-synonym-terms-error"/,
    );
    expect(html).toContain('id="search-synonym-terms-error"');
  });

  it("shows a 400 of the API on the field it names, and the rest in the dialog", () => {
    const html = form({
      fieldErrors: {
        terms: { key: "search.synonyms.error.duplicate_terms" },
        locale: { key: "errors.reason.invalid_value" },
        other: [{ key: "errors.reason.unknown_field" }],
      },
    });
    expect(html).toContain("§search.synonyms.error.duplicate_terms");
    expect(html).toMatch(/<select[^>]*aria-invalid="true"/);
    expect(html).toContain("§errors.reason.unknown_field");
  });

  it("fixes the language when editing and shows the normalized preview", () => {
    const html = form({ mode: "edit", parsed: parseTermsInput("Викрутка, ВІДВЕРТКА") });
    expect(html).not.toContain("<select");
    expect(html).toContain("§search.synonyms.editTitle");
    expect(html).toContain("§search.synonyms.preview");
  });

  it("turns every control off while the write runs", () => {
    const html = form({ busy: true });
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>§search\.synonyms\.cancel<\/button>/);
  });

  it("asks before a delete: an alertdialog naming the group with Cancel focused", () => {
    const html = renderToStaticMarkup(
      <DeleteSynonymDialog
        t={sentinel}
        group={group()}
        busy={false}
        error={null}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("§search.synonyms.deleteBody");
    expect(html).toMatch(/<button[^>]*data-autofocus=""[^>]*>§search\.synonyms\.cancel<\/button>/);
    const closed = renderToStaticMarkup(
      <DeleteSynonymDialog
        t={sentinel}
        group={null}
        busy={false}
        error={null}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(closed).not.toContain("<dialog open");
  });
});

describe("the area with its real messages", () => {
  const loaded = {} as Record<"uk" | "en", Messages>;
  beforeAll(async () => {
    loaded.uk = await messagesForArea("uk", MESSAGE_FILES);
    loaded.en = await messagesForArea("en", MESSAGE_FILES);
  });

  it("renders the status, the list and the dialogs in both languages without a missing key or value", () => {
    for (const language of ["uk", "en"] as const) {
      const t = createTranslator(loaded[language], language);
      const busyStatus = status({
        engine: {
          reachable: false,
          code: "engine_unreachable",
          rejectedSearches: {
            count: 3,
            lastCode: "invalid_search_facets",
            lastAt: "2026-10-29T11:00:00.000Z",
          },
          interactiveLane: REFUSING_LANE,
        },
        locales: [
          locale({
            lastErrorCode: "engine_task_timeout",
            lastErrorAt: "2026-10-29T11:30:00.000Z",
            failedAttempts: 2,
            nextAttemptAt: "2026-10-29T12:10:00.000Z",
            build: { index: "x_2", startedAt: "2026-10-29T11:59:00.000Z", documents: 5 },
          }),
          locale({ locale: "en", settingsFresh: false }),
        ],
        queue: {
          depth: 4,
          due: 3,
          leased: 1,
          dead: 2,
          oldestEnqueuedAt: "2026-10-29T11:00:00.000Z",
          oldestDueAt: "2026-10-29T11:30:00.000Z",
          errorCodes: [{ code: "odd_code", count: 1 }],
        },
      });
      const statusScreen = renderInRouter(
        <StatusView
          t={t}
          uiLocale={language}
          status={busyStatus}
          now={NOW}
          rebuild={
            <RebuildPanel
              t={t}
              uiLocale={language}
              canManage
              busy={false}
              notice={{
                kind: "requested",
                requestedAt: "2026-10-29T12:00:00.000Z",
                locales: ["uk", "en"],
              }}
              confirming
              onAsk={noop}
              onCancel={noop}
              onConfirm={noop}
            />
          }
        />,
      );
      expect(statusScreen.length, language).toBeGreaterThan(500);
      const listScreen = renderInRouter(
        <SynonymResultsView
          t={t}
          uiLocale={language}
          query={{ locale: "", limit: 50, offset: 0 }}
          state={{ status: "ready", data: { items: [group()], total: 120, limit: 50, offset: 0 } }}
          canManage
          onRetry={noop}
          onEdit={noop}
          onDelete={noop}
          hrefForOffset={(offset) => `?offset=${String(offset)}`}
        />,
      );
      expect(listScreen, language).toContain("викрутка");
      const dialog = renderToStaticMarkup(
        <SynonymFormDialog
          t={t}
          open
          mode="create"
          locales={["uk", "en"]}
          locale="uk"
          onLocaleChange={noop}
          text="a, a, long sleeve cotton top, !!!"
          onTextChange={noop}
          parsed={parseTermsInput("a, a, long sleeve cotton top, !!!")}
          showIssues
          fieldErrors={{ terms: { key: "search.synonyms.error.invalid_term" }, other: [] }}
          error={null}
          busy={false}
          onSubmit={noop}
          onClose={noop}
        />,
      );
      expect(dialog, language).toContain("long sleeve cotton top");
      expect(renderToStaticMarkup(<SearchOffView t={t} />), language).toContain("SEARCH_ENABLED");
    }
  });
});
