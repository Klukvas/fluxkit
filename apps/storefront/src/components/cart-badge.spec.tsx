import { NumberRoll } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CartBadgeView, nextBadgeMotion, opensCartDrawer } from "./cart-badge";
import { findElements, sentinelTranslator } from "./test-helpers";

const plain = {
  button: 0,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
};
const t = sentinelTranslator();

describe("cart badge drawer enhancement", () => {
  it("opens for a plain primary click outside the cart and checkout", () => {
    expect(opensCartDrawer(plain, "/en/catalog", "en")).toBe(true);
    expect(opensCartDrawer(plain, "/en/cart", "en")).toBe(false);
    expect(opensCartDrawer(plain, "/en/checkout", "en")).toBe(false);
    for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey", "defaultPrevented"] as const) {
      expect(opensCartDrawer({ ...plain, [key]: true }, "/en/catalog", "en")).toBe(false);
    }
    expect(opensCartDrawer({ ...plain, button: 1 }, "/en/catalog", "en")).toBe(false);
  });

  it("does not bump on the first ready count, or on an unrelated cart state update", () => {
    const baseline = nextBadgeMotion({ count: null, revision: 0 }, 2);
    expect(baseline).toEqual({ count: 2, revision: 0 });
    expect(nextBadgeMotion(baseline, 2)).toBe(baseline);
    const changed = nextBadgeMotion(baseline, 3);
    expect(changed).toEqual({ count: 3, revision: 1 });
    expect(nextBadgeMotion(changed, 2)).toEqual({ count: 2, revision: 2 });
  });

  it("retains a real localized link and forwards its click with the opener intact", () => {
    const click = vi.fn();
    const props = {
      state: { status: "ready" as const, count: 2 },
      t,
      locale: "en" as const,
      onClick: click,
    };
    const [link] = findElements(
      CartBadgeView(props),
      (element) => element.props.href === "/en/cart",
    );
    const event = { ...plain, currentTarget: {} };
    (link?.props.onClick as (event: unknown) => void)(event);
    expect(click).toHaveBeenCalledWith(event);
    expect(renderToStaticMarkup(<CartBadgeView {...props} />)).toContain('href="/en/cart"');
  });

  it("renders exactly the count as decorative badge text", () => {
    for (const count of [1, 2, 12]) {
      const props = {
        state: { status: "ready" as const, count },
        t,
        locale: "en" as const,
        animated: true,
      };
      const [number] = findElements(CartBadgeView(props), (element) => element.type === NumberRoll);
      expect(number?.props.decorative).toBe(true);
      const markup = renderToStaticMarkup(<CartBadgeView {...props} />);
      const badge = markup.match(
        /<span aria-hidden="true" class="[^"]*bg-danger[^"]*">([\s\S]*)<\/span><\/a>$/,
      );
      expect(badge?.[1]?.replace(/<[^>]*>/g, "")).toBe(String(count));
    }
  });

  it("keeps first-render digits plain and adds a rolling number and alternating bump only when requested", () => {
    const props = { state: { status: "ready" as const, count: 2 }, t, locale: "en" as const };
    const initial = renderToStaticMarkup(<CartBadgeView {...props} />);
    expect(initial).not.toContain("fk-badge-bump");
    expect(
      findElements(CartBadgeView(props), (element) => element.type === NumberRoll),
    ).toHaveLength(0);
    expect(
      findElements(
        CartBadgeView({ ...props, animated: true }),
        (element) => element.type === NumberRoll,
      )[0]?.props.value,
    ).toBe(2);
    expect(renderToStaticMarkup(<CartBadgeView {...props} animated bump={1} />)).toContain(
      "fk-badge-bump ",
    );
    expect(renderToStaticMarkup(<CartBadgeView {...props} animated bump={2} />)).toContain(
      "fk-badge-bump-alt ",
    );
  });
});
