import { createStoreClient, type Cart } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import { MAX_LINE_QUANTITY, addToCart } from "./add-to-cart";

function json(body: unknown, status = 200, type = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

function problem(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return json(
    {
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "English detail, never shown",
      ...extra,
    },
    status,
    "application/problem+json",
  );
}

const cart = { lines: [], itemCount: 4 } as unknown as Cart;

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createStoreClient({
    baseUrl: "",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  });
  return { client, calls };
}

describe("addToCart", () => {
  it("posts the variant and quantity to the same origin with the CSRF header, uncached, with the page's locale", async () => {
    const { client, calls } = setup(() => json(cart));
    const outcome = await addToCart(client, { variantId: "variant-1", quantity: 2, locale: "uk" });
    expect(outcome).toEqual({ status: "added", cart });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/store/cart/items?locale=uk");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      variantId: "variant-1",
      quantity: 2,
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-Fluxkit-CSRF")).toBe("1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(calls[0]?.init.cache).toBe("no-store");
  });

  it("calls onAdded with the cart only after a success (the header badge listens to it)", async () => {
    const onAdded = vi.fn();
    const ok = setup(() => json(cart));
    await addToCart(ok.client, { variantId: "v", quantity: 1, locale: "en", onAdded });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledWith(cart);

    onAdded.mockClear();
    const refused = setup(() => problem(409, "rule_violation", { rule: "variant_not_sellable" }));
    await addToCart(refused.client, { variantId: "v", quantity: 1, locale: "en", onAdded });
    expect(onAdded).not.toHaveBeenCalled();
  });

  it.each([
    ["variant_not_sellable", 409, "rule_violation", "errors.rule.variant_not_sellable"],
    ["quantity_limit", 409, "rule_violation", "errors.rule.quantity_limit"],
    ["too_many_lines", 409, "rule_violation", "errors.rule.too_many_lines"],
  ])("maps the %s rule to its translated message", async (rule, status, code, key) => {
    const { client } = setup(() => problem(status, code, { rule }));
    expect(await addToCart(client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: key,
    });
  });

  it("maps 429 and 404 and an unknown code, never showing the API's English detail", async () => {
    const tooMany = setup(() => problem(429, "too_many_requests"));
    expect(await addToCart(tooMany.client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: "errors.too_many_requests",
    });
    const missing = setup(() => problem(404, "not_found"));
    expect(await addToCart(missing.client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: "errors.not_found",
    });
    const unknown = setup(() => problem(418, "brand_new_code"));
    expect(await addToCart(unknown.client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: "errors.generic",
    });
  });

  it("reports a network failure and an unreadable answer as translated failures", async () => {
    const down = setup(() => {
      throw new TypeError("fetch failed");
    });
    expect(await addToCart(down.client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: "errors.network",
    });
    const html = setup(
      () =>
        new Response("<html>bad gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    );
    expect(await addToCart(html.client, { variantId: "v", quantity: 1, locale: "en" })).toEqual({
      status: "failed",
      messageKey: "errors.invalidResponse",
    });
  });

  it("rethrows an abort (the island unmounted) instead of showing an error", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = setup(() => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(
      addToCart(client, { variantId: "v", quantity: 1, locale: "en", signal: controller.signal }),
    ).rejects.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_LINE_QUANTITY + 1])(
    "refuses quantity %s before any request is sent",
    async (quantity) => {
      const { client, calls } = setup(() => json(cart));
      expect(await addToCart(client, { variantId: "v", quantity, locale: "en" })).toEqual({
        status: "failed",
        messageKey: "errors.field.invalid_quantity",
      });
      expect(calls).toHaveLength(0);
    },
  );

  it("allows exactly 1 to 999", async () => {
    expect(MAX_LINE_QUANTITY).toBe(999);
    const { client, calls } = setup(() => json(cart));
    await addToCart(client, { variantId: "v", quantity: 1, locale: "en" });
    await addToCart(client, { variantId: "v", quantity: 999, locale: "en" });
    expect(calls).toHaveLength(2);
  });
});
