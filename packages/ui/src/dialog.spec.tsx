import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";
import { Dialog } from "./dialog";
import { first, render, tags, text } from "./test-helpers";

describe("Dialog", () => {
  const dialog = (open: boolean): string =>
    render(
      <Dialog open={open} onClose={() => undefined} title="Edit price" description="Per variant">
        <p>Body</p>
      </Dialog>,
    );

  it("is a native dialog labelled by its title and described by its description", () => {
    const markup = dialog(true);
    const tag = first(markup, "dialog");
    const heading = first(markup, "h2");
    expect(heading.attributes.id).toBeTruthy();
    expect(tag.attributes["aria-labelledby"]).toBe(heading.attributes.id);
    const description = tags(markup, "p").find((p) => p.attributes.id);
    expect(tag.attributes["aria-describedby"]).toBe(description?.attributes.id);
    expect(text(markup)).toBe("Edit price Per variant Body");
  });

  it("omits aria-describedby without a description", () => {
    const markup = render(
      <Dialog open onClose={() => undefined} title="Title">
        Body
      </Dialog>,
    );
    expect(first(markup, "dialog").attributes).not.toHaveProperty("aria-describedby");
  });

  it("never renders the open attribute: only showModal() opens it modally", () => {
    expect(first(dialog(true), "dialog").attributes).not.toHaveProperty("open");
    expect(first(dialog(false), "dialog").attributes).not.toHaveProperty("open");
  });

  it("renders the footer slot after the body", () => {
    const markup = render(
      <Dialog open onClose={() => undefined} title="T" footer={<button type="button">Save</button>}>
        Body
      </Dialog>,
    );
    expect(text(markup)).toBe("T Body Save");
  });

  it("styles the backdrop with a token and keeps the dialog centered", () => {
    const markup = dialog(true);
    expect(markup).toContain("backdrop:bg-foreground/50");
    expect(markup).toContain("m-auto");
  });
});

describe("ConfirmDialog", () => {
  const confirm = (props: { tone?: "default" | "danger"; busy?: boolean } = {}): string =>
    render(
      <ConfirmDialog
        open
        title="Delete product"
        description="This cannot be undone"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => undefined}
        onClose={() => undefined}
        {...props}
      />,
    );

  it("is an alertdialog with a labelled title and the description", () => {
    const markup = confirm();
    const tag = first(markup, "dialog");
    expect(tag.attributes.role).toBe("alertdialog");
    expect(tag.attributes["aria-labelledby"]).toBe(first(markup, "h2").attributes.id);
    expect(tag.attributes["aria-describedby"]).toBeTruthy();
    expect(text(markup)).toBe("Delete product This cannot be undone Keep Delete");
  });

  it("renders cancel before confirm, both type=button, with labels from props", () => {
    const buttons = tags(confirm(), "button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.attributes.type)).toEqual(["button", "button"]);
    expect(confirm()).toMatch(/Keep<\/button><button[^>]*>Delete<\/button>/);
  });

  it("puts the initial focus on the safe choice: cancel", () => {
    const [cancel, confirmButton] = tags(confirm(), "button");
    expect(cancel?.attributes).toHaveProperty("data-autofocus");
    expect(confirmButton?.attributes).not.toHaveProperty("data-autofocus");
  });

  it("styles the danger tone with the danger token, not only by color", () => {
    const [, danger] = tags(confirm({ tone: "danger" }), "button");
    expect(danger?.attributes.class).toContain("text-danger");
    const [, plain] = tags(confirm(), "button");
    expect(plain?.attributes.class).not.toContain("text-danger");
  });

  it("while busy disables both buttons and sets aria-busy on the dialog and the buttons", () => {
    const markup = confirm({ busy: true });
    for (const button of tags(markup, "button")) {
      expect(button.attributes.disabled).toBe(true);
      expect(button.attributes["aria-busy"]).toBe("true");
    }
    expect(first(markup, "dialog").attributes["aria-busy"]).toBe("true");
  });

  it("is idle by default: enabled buttons, no aria-busy", () => {
    const markup = confirm();
    for (const button of tags(markup, "button")) {
      expect(button.attributes).not.toHaveProperty("disabled");
      expect(button.attributes).not.toHaveProperty("aria-busy");
    }
    expect(first(markup, "dialog").attributes).not.toHaveProperty("aria-busy");
  });
});
