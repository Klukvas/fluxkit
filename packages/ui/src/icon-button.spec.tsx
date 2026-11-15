import { createRef } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import { IconButton, type IconButtonProps } from "./icon-button";
import { PlusIcon } from "./icons";
import { first, render, text } from "./test-helpers";

describe("IconButton", () => {
  it("uses the supplied accessible name and a hidden decorative SVG, defaulting to ghost/md", () => {
    const markup = render(<IconButton label="Add" icon={<PlusIcon className="size-5" />} />);
    expect(first(markup, "button").attributes).toMatchObject({
      type: "button",
      "aria-label": "Add",
    });
    expect(first(markup, "button").attributes.class).toBe(
      "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 size-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring bg-background text-foreground enabled:hover:bg-muted",
    );
    expect(first(markup, "span").attributes["aria-hidden"]).toBe("true");
    expect(first(markup, "svg").attributes["aria-hidden"]).toBe("true");
    expect(first(markup, "svg").attributes.class).toBe("shrink-0 size-5");
    expect(text(markup)).toBe("");
  });
  it("forwards size, variant, native props and ref without padding or label gap", () => {
    const ref = createRef<HTMLButtonElement>();
    const props = {
      label: "Delete",
      icon: <PlusIcon />,
      ref,
      size: "lg",
      variant: "danger",
      type: "submit",
      disabled: true,
      name: "delete",
      className: "w-full",
    } as const;
    const markup = render(<IconButton {...props} />);
    expect(first(markup, "button").attributes).toMatchObject({
      type: "submit",
      disabled: true,
      name: "delete",
    });
    expect(first(markup, "button").attributes.class).toBe(
      "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 size-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border-2 border-danger bg-background text-danger enabled:hover:bg-muted w-full",
    );
    expect(IconButton(props).props.ref).toBe(ref);
  });
  it("requires a label and rejects competing names and children at typecheck", () => {
    type Accepts<Props> = Props extends IconButtonProps ? true : false;
    type Icon = { icon: ReturnType<typeof PlusIcon> };
    expectTypeOf<Accepts<Icon>>().toEqualTypeOf<false>();
    expectTypeOf<Accepts<Icon & { label: string }>>().toEqualTypeOf<true>();
    expectTypeOf<Accepts<Icon & { label: string; children: string }>>().toEqualTypeOf<false>();
    expectTypeOf<Accepts<Icon & { label: string; "aria-label": string }>>().toEqualTypeOf<false>();
    expectTypeOf<
      Accepts<Icon & { label: string; "aria-labelledby": string }>
    >().toEqualTypeOf<false>();
  });
});
