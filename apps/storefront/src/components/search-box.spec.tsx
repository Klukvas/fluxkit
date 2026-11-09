import { Input } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { closedCombobox, type ComboboxState } from "../lib/combobox-model";
import { clientFailure } from "../lib/failure";
import { SearchBoxView, searchBoxAnnouncement, type SearchBoxViewProps } from "./search-box";
import { findElements, leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();
const open = (activeIndex: number): ComboboxState => ({ open: true, activeIndex });
const two = [
  { slug: "screwdriver", title: "§Screwdriver" },
  { slug: "screw-set", title: "§Screwset" },
];

function props(overrides: Partial<SearchBoxViewProps> = {}): SearchBoxViewProps {
  return {
    t,
    locale: "uk",
    id: "box",
    text: "",
    combo: closedCombobox,
    options: [],
    status: "idle",
    failure: null,
    onTextChange: vi.fn(),
    onKeyDown: vi.fn(),
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    onHighlight: vi.fn(),
    onChoose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}
const render = (overrides: Partial<SearchBoxViewProps> = {}) =>
  renderToStaticMarkup(<SearchBoxView {...props(overrides)} />);

describe("search box markup (WAI-ARIA combobox with a listbox popup, inside a search form)", () => {
  it("is a search landmark, a GET form to the locale's results page that works without a script", () => {
    const html = render();
    expect(html).toMatch(
      /^<form role="search" aria-label="§searchBox\.label"[^>]* action="\/uk\/search" method="get">/,
    );
    expect(render({ locale: "en" })).toContain('action="/en/search"');
    expect(html).toMatch(/<button type="submit"[^>]*>§searchBox\.submit<\/button>/);
  });

  it("has a real label for the text box and sends the words as q", () => {
    const html = render();
    expect(html).toContain('<label for="box" class="sr-only">§searchBox.input</label>');
    expect(html).toMatch(
      /<input type="search"[^>]* id="box" role="combobox"[^>]* name="q" value=""\/>/,
    );
    expect(html).toContain('maxLength="200"');
  });

  it("is a combobox that controls a listbox, collapsed while there is nothing to choose", () => {
    const html = render();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="box-list"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain("aria-activedescendant");
    expect(html).toMatch(
      /<ul id="box-list" role="listbox" aria-label="§searchBox\.suggestions\.label" hidden=""/,
    );
  });

  it("opens the list: options with ids and aria-selected, the highlighted one named by aria-activedescendant", () => {
    const html = render({ combo: open(1), options: two, status: "ready" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-activedescendant="box-list-option-1"');
    expect(html).toContain('<li id="box-list-option-0" role="option" aria-selected="false"');
    expect(html).toContain('<li id="box-list-option-1" role="option" aria-selected="true"');
    expect(html).not.toMatch(/<ul id="box-list"[^>]*hidden/);
  });

  it("never points at an option that is not there, and keeps the list closed when the popup is closed", () => {
    expect(render({ combo: open(5), options: two, status: "ready" })).not.toContain(
      "aria-activedescendant",
    );
    const closed = render({ combo: closedCombobox, options: two, status: "ready" });
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toMatch(/<ul id="box-list"[^>]*hidden/);
  });

  it("shows the suggestions' titles as text", () => {
    const html = render({
      combo: open(-1),
      options: [{ slug: "x", title: "<img src=x onerror=alert(1)>" }],
      status: "ready",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("has a polite live region from the start and says what happened: searching, how many, nothing, a failure with its wait", () => {
    const region = (html: string) => html.match(/<div role="status"[^>]*>(.*?)<\/div>/)?.[1];
    expect(render()).toContain(
      '<div role="status" aria-live="polite" aria-atomic="true" class="sr-only"></div>',
    );
    expect(region(render({ status: "loading", combo: open(-1) }))).toBe("§searchBox.loading");
    expect(region(render({ status: "ready", options: two, combo: open(-1) }))).toBe(
      "§searchBox.results:2",
    );
    expect(region(render({ status: "ready", options: [], combo: open(-1) }))).toBe(
      "§searchBox.empty",
    );
    const failure = { ...clientFailure("errors.too_many_requests"), retryAfterSeconds: 20 };
    expect(searchBoxAnnouncement(t, { status: "error", options: [], failure })).toBe(
      "§errors.too_many_requests §errors.retryAfter:20",
    );
    expect(searchBoxAnnouncement(t, { status: "waiting", options: [], failure: null })).toBe("");
  });

  it("shows the status under the box, over the page (no layout shift): searching, nothing found, failed", () => {
    const loading = render({ status: "loading", combo: open(-1) });
    expect(loading).toContain("absolute");
    expect(loading).toMatch(/<p class="[^"]*">§searchBox\.loading<\/p>/);
    expect(render({ status: "ready", options: [], combo: open(-1) })).toMatch(
      /<p class="[^"]*">§searchBox\.empty<\/p>/,
    );
    const failed = render({
      status: "error",
      combo: open(-1),
      failure: { ...clientFailure("errors.search_unavailable"), retryAfterSeconds: 30 },
    });
    expect(failed).toContain("§errors.search_unavailable §errors.retryAfter:30");
    // Closed popup: no status text (and nothing for the idle and waiting states).
    expect(render({ status: "loading" })).not.toMatch(/<p class/);
    expect(render({ status: "waiting", combo: open(-1) })).not.toMatch(/<p class/);
  });

  it("has no hardcoded words in any state", () => {
    const states: Partial<SearchBoxViewProps>[] = [
      {},
      { status: "loading", combo: open(-1) },
      { status: "ready", options: two, combo: open(0) },
      { status: "ready", options: [], combo: open(-1) },
      { status: "error", combo: open(-1), failure: clientFailure("errors.search_unavailable") },
    ];
    for (const state of states) {
      const html = render(state);
      expect(
        leftoverText(html)
          .replace(/§Screw[a-z]*/g, " ")
          .trim(),
      ).toBe("");
      for (const text of textAttributes(html)) expect(text).toMatch(/^§[A-Za-z0-9_.:-]+$|^$/);
    }
  });

  it("hands the typed text, the keys, the focus, a click, the pointer and the submit to its handlers; a press does not blur the box", () => {
    const handlers = {
      onTextChange: vi.fn(),
      onKeyDown: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onHighlight: vi.fn(),
      onChoose: vi.fn(),
      onSubmit: vi.fn(),
    };
    const tree = SearchBoxView(
      props({ combo: open(0), options: two, status: "ready", ...handlers }),
    );
    const [input] = findElements(tree, (node) => node.type === Input);
    (input?.props.onChange as (event: unknown) => void)({ currentTarget: { value: "scr" } });
    expect(handlers.onTextChange).toHaveBeenCalledWith("scr");
    const keyEvent = { key: "ArrowDown" };
    (input?.props.onKeyDown as (event: unknown) => void)(keyEvent);
    expect(handlers.onKeyDown).toHaveBeenCalledWith(keyEvent);
    (input?.props.onFocus as () => void)();
    (input?.props.onBlur as () => void)();
    expect(handlers.onFocus).toHaveBeenCalledTimes(1);
    expect(handlers.onBlur).toHaveBeenCalledTimes(1);

    const [, second] = findElements(tree, (node) => node.type === "li");
    const press = { preventDefault: vi.fn() };
    (second?.props.onMouseDown as (event: unknown) => void)(press);
    expect(press.preventDefault).toHaveBeenCalledTimes(1);
    (second?.props.onMouseMove as () => void)();
    expect(handlers.onHighlight).toHaveBeenCalledWith(1);
    (second?.props.onClick as () => void)();
    expect(handlers.onChoose).toHaveBeenCalledWith(1);

    const [form] = findElements(tree, (node) => node.type === "form");
    (form?.props.onSubmit as () => void)();
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });
});
