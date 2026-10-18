import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Field } from "./field";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";
import { VisuallyHidden } from "./visually-hidden";
import { first, render, tags, text } from "./test-helpers";

describe("VisuallyHidden", () => {
  it("hides content visually but keeps it in the accessibility tree", () => {
    const markup = render(<VisuallyHidden>Label</VisuallyHidden>);
    expect(first(markup, "span").attributes.class).toContain("sr-only");
    expect(first(markup, "span").attributes).not.toHaveProperty("aria-hidden");
    expect(text(markup)).toBe("Label");
  });
});

describe("Input, Textarea, Select", () => {
  it("Input passes native attributes and defaults to a text input", () => {
    const input = first(
      render(<Input name="email" type="email" autoComplete="email" required disabled />),
      "input",
    );
    expect(input.attributes).toMatchObject({ name: "email", type: "email", autoComplete: "email" });
    expect(input.attributes.required).toBe(true);
    expect(input.attributes.disabled).toBe(true);
    expect(first(render(<Input />), "input").attributes.type).toBe("text");
  });

  it("Input forwards its ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref).toHaveProperty("current");
  });

  it("Input styles the invalid state through aria-invalid, not a separate prop", () => {
    const input = first(render(<Input aria-invalid="true" />), "input");
    expect(input.attributes["aria-invalid"]).toBe("true");
    expect(input.attributes.class).toContain("aria-invalid:border-danger");
  });

  it("controls show a visible focus indicator from the ring token", () => {
    for (const markup of [
      render(<Input />),
      render(<Textarea />),
      render(<Select>{null}</Select>),
      render(<Checkbox label="L" />),
    ]) {
      expect(markup).toContain("focus-visible:outline-ring");
    }
  });

  it("Textarea renders a textarea with rows and a disabled state", () => {
    const textarea = first(render(<Textarea rows={4} name="note" disabled />), "textarea");
    expect(textarea.attributes).toMatchObject({ rows: "4", name: "note" });
    expect(textarea.attributes.disabled).toBe(true);
  });

  it("Select renders options and a disabled state", () => {
    const markup = render(
      <Select name="country" defaultValue="b" disabled>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    expect(first(markup, "select").attributes.disabled).toBe(true);
    expect(tags(markup, "option")).toHaveLength(2);
  });
});

describe("Checkbox", () => {
  it("associates the label with the input and passes checked and disabled", () => {
    const markup = render(
      <Checkbox id="terms" label="Accept" name="terms" defaultChecked disabled />,
    );
    const input = first(markup, "input");
    expect(input.attributes).toMatchObject({ type: "checkbox", id: "terms", name: "terms" });
    expect(input.attributes.checked).toBe(true);
    expect(input.attributes.disabled).toBe(true);
    expect(first(markup, "label").attributes.for).toBe("terms");
    expect(markup).toMatch(/<label[^>]*>.*<input.*<\/label>/);
    expect(text(markup)).toBe("Accept");
  });

  it("links a description through aria-describedby", () => {
    const input = first(
      render(<Checkbox label="A" aria-describedby="terms-error" aria-invalid="true" />),
      "input",
    );
    expect(input.attributes["aria-describedby"]).toBe("terms-error");
    expect(input.attributes["aria-invalid"]).toBe("true");
  });
});

describe("Field", () => {
  const field = (props: Partial<Parameters<typeof Field>[0]> = {}): string =>
    render(
      <Field id="email" label="Email" {...props}>
        {(control) => <Input name="email" {...control} />}
      </Field>,
    );

  it("associates the label with the control by id", () => {
    const markup = field();
    expect(first(markup, "label").attributes.for).toBe("email");
    expect(first(markup, "input").attributes.id).toBe("email");
    expect(text(markup)).toBe("Email");
  });

  it("without hint or error adds no aria-describedby and no aria-invalid", () => {
    const input = first(field(), "input");
    expect(input.attributes).not.toHaveProperty("aria-describedby");
    expect(input.attributes).not.toHaveProperty("aria-invalid");
  });

  it("links the hint through aria-describedby", () => {
    const markup = field({ hint: "We never share it" });
    expect(first(markup, "input").attributes["aria-describedby"]).toBe("email-hint");
    expect(markup).toContain('id="email-hint"');
    expect(markup).toContain("We never share it");
  });

  it("links the error, marks the control invalid and keeps the hint linked first", () => {
    const markup = field({ hint: "Hint", error: "Enter a valid email" });
    const input = first(markup, "input");
    expect(input.attributes["aria-invalid"]).toBe("true");
    expect(input.attributes["aria-describedby"]).toBe("email-hint email-error");
    expect(markup).toContain('id="email-error"');
    expect(markup).toContain("Enter a valid email");
  });

  it("marks a required field natively and shows the indicator only visually", () => {
    const markup = field({ required: true, requiredIndicator: "*" });
    expect(first(markup, "input").attributes.required).toBe(true);
    const indicator = first(markup, "span");
    expect(indicator.attributes["aria-hidden"]).toBe("true");
    expect(first(field({ required: false }), "input").attributes).not.toHaveProperty("required");
    expect(tags(field({ required: true }), "span")).toHaveLength(0);
  });

  it("works with a textarea and a select as the control", () => {
    const markup = render(
      <Field id="note" label="Note" error="Too long">
        {(control) => <Textarea {...control} />}
      </Field>,
    );
    expect(first(markup, "textarea").attributes).toMatchObject({
      id: "note",
      "aria-invalid": "true",
      "aria-describedby": "note-error",
    });
  });
});

describe("Button", () => {
  it("shows a visible focus indicator and keeps type=button by default", () => {
    const button = first(render(<Button>Go</Button>), "button");
    expect(button.attributes.type).toBe("button");
    expect(button.attributes.class).toContain("focus-visible:outline-ring");
  });
});
