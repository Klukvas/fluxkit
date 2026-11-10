import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { sentinelTranslator } from "../components/test-helpers";
import {
  renderSlot,
  slotComponents,
  SLOT_NAMES,
  type FooterColumnsSlotProps,
  type HeaderTopSlotProps,
  type ProductCardSlotProps,
  type SlotComponent,
  type SlotRegistry,
} from "./slots";

const t = sentinelTranslator();
const headerProps: HeaderTopSlotProps = { locale: "uk", t };

function First({ locale }: HeaderTopSlotProps) {
  return <p data-first={locale}>first</p>;
}
function Second() {
  return <p data-second="">second</p>;
}

/** What a `'use client'` module's export is on the server (`$$typeof` of a client reference). */
function clientReference(): SlotComponent<"header.top"> {
  const reference = () => null;
  return Object.assign(reference, { $$typeof: Symbol.for("react.client.reference") });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the slot names", () => {
  it("are exactly the four slots of the contract (docs/contracts/slots.md)", () => {
    expect([...SLOT_NAMES]).toEqual([
      "header.top",
      "product-card.badges",
      "product-card.actions",
      "footer.columns",
    ]);
  });

  // At compile time `export const slots: SlotRegistry = { ... }` refuses a name outside these keys (excess property check of
  // the object literal) and a component whose props are not the slot's view model.
  it("types the registry by exactly these names, each slot with its own view model", () => {
    expectTypeOf<keyof SlotRegistry>().toEqualTypeOf<(typeof SLOT_NAMES)[number]>();
    expectTypeOf<Parameters<SlotComponent<"header.top">>[0]>().toEqualTypeOf<HeaderTopSlotProps>();
    expectTypeOf<
      Parameters<SlotComponent<"product-card.badges">>[0]
    >().toEqualTypeOf<ProductCardSlotProps>();
    expectTypeOf<
      Parameters<SlotComponent<"product-card.actions">>[0]
    >().toEqualTypeOf<ProductCardSlotProps>();
    expectTypeOf<
      Parameters<SlotComponent<"footer.columns">>[0]
    >().toEqualTypeOf<FooterColumnsSlotProps>();
    expectTypeOf<{ "header.top": [typeof First] }>().toExtend<SlotRegistry>();
    expectTypeOf<{
      "product-card.badges": [(props: { card: { unknown: true } }) => string];
    }>().not.toExtend<SlotRegistry>();
  });
});

describe("renderSlot", () => {
  it("renders nothing at all for an empty registry or a slot without components: null, no wrapper", () => {
    for (const name of SLOT_NAMES) expect(slotComponents(name, {})).toEqual([]);
    expect(renderSlot("header.top", headerProps, {})).toBeNull();
    expect(renderSlot("header.top", headerProps, { "header.top": [] })).toBeNull();
    expect(renderSlot("header.top", headerProps, { "footer.columns": [() => "x"] })).toBeNull();
  });

  it("renders the components in their order, each with the view model, with no element around them", () => {
    const nodes = renderSlot("header.top", headerProps, { "header.top": [First, Second] });
    expect(renderToStaticMarkup(<>{nodes}</>)).toBe(
      '<p data-first="uk">first</p><p data-second="">second</p>',
    );
  });

  it("throws outside production for a slot name the contract does not know, naming it and the known ones", () => {
    const registry = { "header.bottom": [First] } as unknown as SlotRegistry;
    expect(() => renderSlot("header.top", headerProps, registry)).toThrow(
      /unknown slot "header\.bottom".*header\.top, product-card\.badges, product-card\.actions, footer\.columns/,
    );
  });

  it("in production leaves an unknown name out and logs it once per name, while the known slots still render", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const registry = {
      "header.top": [First],
      "header.prod-typo": [Second],
    } as unknown as SlotRegistry;
    const html = () => renderToStaticMarkup(<>{renderSlot("header.top", headerProps, registry)}</>);
    expect(html()).toBe('<p data-first="uk">first</p>');
    expect(html()).toBe('<p data-first="uk">first</p>');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/unknown slot "header\.prod-typo".*left out/);
  });

  it("throws in every environment for a client component registered directly, and for an entry that is not a component", () => {
    for (const environment of ["test", "production"]) {
      vi.stubEnv("NODE_ENV", environment);
      expect(() =>
        renderSlot("header.top", headerProps, { "header.top": [clientReference()] }),
      ).toThrow(/header\.top.*client component \('use client'\)/);
      expect(() =>
        renderSlot("header.top", headerProps, {
          "header.top": [null as unknown as SlotComponent<"header.top">],
        }),
      ).toThrow(/header\.top.*not a component/);
      expect(() =>
        renderSlot("header.top", headerProps, {
          "header.top": First as unknown as readonly SlotComponent<"header.top">[],
        }),
      ).toThrow(/header\.top.*not a list/);
    }
  });

  it("counts own entries only: a slot inherited through the prototype renders nothing", () => {
    const registry = Object.create({ "header.top": [First] }) as SlotRegistry;
    expect(renderSlot("header.top", headerProps, registry)).toBeNull();
  });
});
