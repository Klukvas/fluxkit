import { describe, expect, it } from "vitest";
import { OptionPicker } from "./option-picker";
import { PriceText } from "./price-text";
import { ProductImage } from "./product-image";
import { clampQuantity, QuantityInput } from "./quantity-input";
import { first, render, tags, text } from "./test-helpers";

describe("PriceText", () => {
  it("renders the preformatted price as given", () => {
    const markup = render(<PriceText price="1 299,00 ₴" />);
    expect(text(markup)).toBe("1 299,00 ₴");
    expect(tags(markup, "s")).toHaveLength(0);
  });

  it("renders a struck-through compare-at price with accessible text from props", () => {
    const markup = render(
      <PriceText price="800 ₴" priceLabel="Now" compareAt="1 000 ₴" compareAtLabel="Was" />,
    );
    expect(text(markup)).toBe("Now 800 ₴ Was 1 000 ₴");
    expect(markup).toMatch(/<s[^>]*>1 000 ₴<\/s>/);
    expect(markup).toMatch(/<span class="sr-only">Was<\/span>/);
  });
});

describe("QuantityInput", () => {
  const props = {
    value: 2,
    onChange: () => undefined,
    label: "Quantity",
    decreaseLabel: "Decrease quantity",
    increaseLabel: "Increase quantity",
  };

  it("labels the input and both buttons from props", () => {
    const markup = render(<QuantityInput {...props} min={1} max={5} name="qty" />);
    const input = first(markup, "input");
    expect(input.attributes).toMatchObject({
      type: "number",
      inputMode: "numeric",
      value: "2",
      min: "1",
      max: "5",
      name: "qty",
      "aria-label": "Quantity",
    });
    const buttons = tags(markup, "button");
    expect(buttons.map((button) => button.attributes["aria-label"])).toEqual([
      "Decrease quantity",
      "Increase quantity",
    ]);
    expect(buttons.every((button) => button.attributes.type === "button")).toBe(true);
    expect(text(markup)).not.toContain("Quantity");
  });

  it("disables decrease at the minimum and increase at the maximum", () => {
    const atMin = tags(render(<QuantityInput {...props} value={1} min={1} max={5} />), "button");
    expect(atMin[0]?.attributes.disabled).toBe(true);
    expect(atMin[1]?.attributes).not.toHaveProperty("disabled");
    const atMax = tags(render(<QuantityInput {...props} value={5} min={1} max={5} />), "button");
    expect(atMax[0]?.attributes).not.toHaveProperty("disabled");
    expect(atMax[1]?.attributes.disabled).toBe(true);
  });

  it("disables everything when disabled", () => {
    const markup = render(<QuantityInput {...props} disabled />);
    expect(tags(markup, "button").every((button) => button.attributes.disabled === true)).toBe(
      true,
    );
    expect(first(markup, "input").attributes.disabled).toBe(true);
  });

  it("has no maximum attribute when none is given", () => {
    expect(first(render(<QuantityInput {...props} />), "input").attributes).not.toHaveProperty(
      "max",
    );
  });

  it("clamps typed values into the allowed range as whole numbers", () => {
    expect(clampQuantity(3, 1, 5)).toBe(3);
    expect(clampQuantity(0, 1, 5)).toBe(1);
    expect(clampQuantity(9, 1, 5)).toBe(5);
    expect(clampQuantity(2.7, 1, 5)).toBe(2);
    expect(clampQuantity(9, 1, undefined)).toBe(9);
  });
});

describe("ProductImage", () => {
  it("renders a lazy image with dimensions and alt text from props", () => {
    const markup = render(<ProductImage src="/a.jpg" alt="Red mug" width={400} height={300} />);
    expect(first(markup, "img").attributes).toMatchObject({
      src: "/a.jpg",
      alt: "Red mug",
      width: "400",
      height: "300",
      loading: "lazy",
      decoding: "async",
    });
  });

  it("renders a token-styled placeholder when the source is missing", () => {
    for (const src of [undefined, null, ""]) {
      const markup = render(<ProductImage src={src} alt="Red mug" width={400} height={300} />);
      expect(tags(markup, "img")).toHaveLength(0);
      const placeholder = first(markup, "div");
      expect(placeholder.attributes.role).toBe("img");
      expect(placeholder.attributes["aria-label"]).toBe("Red mug");
      expect(placeholder.attributes.class).toContain("bg-muted");
    }
  });

  it("hides a decorative placeholder (empty alt) from assistive technology", () => {
    const placeholder = first(render(<ProductImage alt="" width={4} height={3} />), "div");
    expect(placeholder.attributes["aria-hidden"]).toBe("true");
    expect(placeholder.attributes).not.toHaveProperty("role");
  });

  it("keeps an empty alt on a decorative image", () => {
    expect(
      first(render(<ProductImage src="/a.jpg" alt="" width={4} height={3} />), "img").attributes
        .alt,
    ).toBe("");
  });
});

describe("OptionPicker", () => {
  const values = [
    { value: "red", label: "Red" },
    { value: "blue", label: "Blue", disabled: true },
    { value: "green", label: "Green" },
  ];
  const picker = (selected: string | null = "red"): string =>
    render(
      <OptionPicker
        name="color"
        legend="Color"
        values={values}
        selected={selected}
        onChange={() => undefined}
      />,
    );

  it("is a fieldset with a legend and one radio per value in one group", () => {
    const markup = picker();
    expect(tags(markup, "fieldset")).toHaveLength(1);
    expect(markup).toMatch(/<legend[^>]*>Color<\/legend>/);
    const radios = tags(markup, "input");
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => radio.attributes.type === "radio")).toBe(true);
    expect(new Set(radios.map((radio) => radio.attributes.name))).toEqual(new Set(["color"]));
    expect(radios.map((radio) => radio.attributes.value)).toEqual(["red", "blue", "green"]);
  });

  it("checks only the selected value and none when nothing is selected", () => {
    const checked = (markup: string): (string | true | undefined)[] =>
      tags(markup, "input")
        .filter((radio) => radio.attributes.checked === true)
        .map((radio) => radio.attributes.value);
    expect(checked(picker("green"))).toEqual(["green"]);
    expect(checked(picker(null))).toEqual([]);
  });

  it("disables unavailable values and marks them without relying on color", () => {
    const markup = picker();
    const radios = tags(markup, "input");
    expect(radios.map((radio) => radio.attributes.disabled === true)).toEqual([false, true, false]);
    expect(markup).toContain("line-through");
  });

  it("keeps radios focusable for the keyboard (visually hidden, not display none) and shows focus", () => {
    const markup = picker();
    expect(first(markup, "input").attributes.class).toContain("sr-only");
    expect(markup).toContain("peer-focus-visible:outline-ring");
  });

  it("wraps each radio in its label", () => {
    expect(tags(picker(), "label")).toHaveLength(3);
    expect(text(picker())).toBe("Color Red Blue Green");
  });
});
