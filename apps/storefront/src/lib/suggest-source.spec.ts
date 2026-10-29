import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  createSuggestSource,
  suggestKey,
  suggestionHref,
} from "./suggest-source";
import { json, problem, stagedClient } from "./test-fetch";

afterEach(() => vi.useRealTimers());

const settle = () => vi.advanceTimersByTimeAsync(0);

function setup() {
  vi.useFakeTimers();
  const { client, calls } = stagedClient();
  return { source: createSuggestSource(client, "uk"), calls };
}

describe("suggest source (the header box's GET /store/search/suggest)", () => {
  it("waits for 2 characters and 200 ms of quiet, then asks once with the text and the locale", () => {
    expect([SUGGEST_MIN_CHARS, SUGGEST_DEBOUNCE_MS]).toEqual([2, 200]);
    const { source, calls } = setup();
    source.setQuery("s");
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(0);
    source.setQuery("sc");
    vi.advanceTimersByTime(199);
    expect(calls).toHaveLength(0);
    source.setQuery(" scr ");
    vi.advanceTimersByTime(199);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? "", "http://x");
    expect(url.pathname).toBe("/store/search/suggest");
    expect(url.searchParams.get("q")).toBe("scr");
    expect(url.searchParams.get("locale")).toBe("uk");
    expect([...url.searchParams.keys()].sort()).toEqual(["locale", "q"]);
    expect(calls[0]?.method).toBe("GET");
  });

  it("sends nothing for one character, also not after spaces are trimmed", () => {
    const { source, calls } = setup();
    for (const text of ["", "a", "  b ", " "]) source.setQuery(text);
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(0);
    expect(source.getState().status).toBe("idle");
  });

  it("aborts the request of the text the shopper has typed past, and shows only the newest answer", async () => {
    const { source, calls } = setup();
    source.setQuery("scr");
    vi.advanceTimersByTime(200);
    const stale = calls[0];
    expect(stale?.init.signal?.aborted).toBe(false);
    source.setQuery("screw");
    expect(stale?.init.signal?.aborted).toBe(true);
    vi.advanceTimersByTime(200);
    // Even if the stale answer arrives anyway it changes nothing.
    stale?.answer(json({ items: [{ slug: "old", title: "Old" }] }));
    await settle();
    expect(source.getState()).toMatchObject({ status: "loading", items: [] });
    calls[1]?.answer(json({ items: [{ slug: "screwdriver", title: "Screwdriver" }] }));
    await settle();
    expect(source.getState()).toMatchObject({
      status: "ready",
      items: [{ slug: "screwdriver", title: "Screwdriver" }],
      total: 1,
    });
  });

  it("reads 429 and 503 as failures with their message keys and the wait, never as an empty list", async () => {
    const { source, calls } = setup();
    source.setQuery("screw");
    vi.advanceTimersByTime(200);
    calls[0]?.answer(problem(429, "too_many_requests", {}, { "Retry-After": "20" }));
    await settle();
    expect(source.getState().status).toBe("error");
    expect(source.getState().failure).toMatchObject({
      messageKey: "errors.too_many_requests",
      retryAfterSeconds: 20,
    });
    source.retry();
    calls[1]?.answer(problem(503, "search_unavailable", {}, { "Retry-After": "30" }));
    await settle();
    expect(source.getState().failure).toMatchObject({ messageKey: "errors.search_unavailable" });
  });

  it("reads an empty answer as nothing found", async () => {
    const { source, calls } = setup();
    source.setQuery("zzzz");
    vi.advanceTimersByTime(200);
    calls[0]?.answer(json({ items: [] }));
    await settle();
    expect(source.getState()).toMatchObject({ status: "ready", items: [], total: 0 });
  });
});

describe("suggestKey (the keys of the search box)", () => {
  const closed = { open: false, activeIndex: -1 };
  const open = { open: true, activeIndex: -1 };

  it("opens and walks the list like every combobox", () => {
    expect(suggestKey(closed, "ArrowDown", 3).state).toEqual({ open: true, activeIndex: 0 });
    expect(suggestKey({ open: true, activeIndex: 2 }, "ArrowDown", 3).state.activeIndex).toBe(0);
    expect(suggestKey(closed, "ArrowUp", 3).state).toEqual({ open: true, activeIndex: 2 });
    expect(suggestKey(open, "Escape", 3).state).toEqual(closed);
  });

  it("takes the highlighted suggestion on Enter and keeps the form from submitting", () => {
    expect(suggestKey({ open: true, activeIndex: 1 }, "Enter", 3)).toEqual({
      state: closed,
      select: 1,
      preventDefault: true,
    });
  });

  it("lets Enter submit the search when nothing is highlighted, even with the list open", () => {
    expect(suggestKey(open, "Enter", 3)).toEqual({
      state: closed,
      select: null,
      preventDefault: false,
    });
    expect(suggestKey(closed, "Enter", 0)).toEqual({
      state: closed,
      select: null,
      preventDefault: false,
    });
  });
});

describe("suggestionHref", () => {
  it("links the product page of the locale, with the slug encoded", () => {
    expect(suggestionHref("uk", "screw-driver")).toBe("/uk/p/screw-driver");
    expect(suggestionHref("en", "a b/c")).toBe("/en/p/a%20b%2Fc");
  });
});
