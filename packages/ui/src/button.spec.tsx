import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Button, type ButtonVariant, type ButtonSize } from "./button";
import { render, first } from "./test-helpers";

// Literal pre-PR-2 classes: keep every existing storefront button byte-identical.
const baselines: [ButtonVariant, ButtonSize, string][] = [
  [
    "primary",
    "md",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring bg-primary text-primary-foreground enabled:hover:bg-primary/90",
  ],
  [
    "primary",
    "lg",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 min-h-12 px-6 py-2 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring bg-primary text-primary-foreground enabled:hover:bg-primary/90",
  ],
  [
    "secondary",
    "md",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border border-border bg-background text-foreground enabled:hover:bg-muted",
  ],
  [
    "secondary",
    "lg",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 min-h-12 px-6 py-2 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border border-border bg-background text-foreground enabled:hover:bg-muted",
  ],
  [
    "danger",
    "md",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border border-danger bg-background text-danger enabled:hover:bg-muted",
  ],
  [
    "danger",
    "lg",
    "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 min-h-12 px-6 py-2 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border border-danger bg-background text-danger enabled:hover:bg-muted",
  ],
];
describe("Button compatibility", () => {
  for (const [variant, size, classes] of baselines) {
    it(`preserves ${variant}/${size} classes and children`, () => {
      expect(
        render(
          <Button variant={variant} size={size}>
            Save<strong> now</strong>
          </Button>,
        ),
      ).toBe(`<button type="button" class="${classes}">Save<strong> now</strong></button>`);
    });
  }
  it("preserves defaults, caller classes, refs and native props", () => {
    const ref = createRef<HTMLButtonElement>();
    const markup = render(
      <Button
        ref={ref}
        className="w-full"
        type="submit"
        disabled
        name="save"
        value="yes"
        aria-busy="true"
      >
        Save
      </Button>,
    );
    expect(first(render(<Button>Save</Button>), "button").attributes.class).toBe(baselines[0]?.[2]);
    expect(first(markup, "button").attributes).toMatchObject({
      class: `${baselines[0]?.[2]} w-full`,
      type: "submit",
      disabled: true,
      name: "save",
      value: "yes",
      "aria-busy": "true",
    });
    expect(Button({ ref }).props.ref).toBe(ref);
  });
});

describe("Button additive presentation", () => {
  it("adds the exact ghost variant without a border", () => {
    expect(first(render(<Button variant="ghost">Cancel</Button>), "button").attributes.class).toBe(
      "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring bg-background text-foreground enabled:hover:bg-muted",
    );
  });
  it("puts a hidden icon before the label, adding gap before caller classes only with an icon", () => {
    const markup = render(
      <Button icon={<svg className="size-5" />} className="w-full">
        Save
      </Button>,
    );
    expect(first(markup, "button").attributes.class).toBe(`${baselines[0]?.[2]} gap-2 w-full`);
    expect(markup).toContain(
      '<span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center"><svg class="size-5"></svg></span>Save',
    );
    expect(render(<Button icon={null}>Save</Button>)).toBe(render(<Button>Save</Button>));
    expect(Button({ children: "Save" }).props.children).toBe("Save");
  });
});
