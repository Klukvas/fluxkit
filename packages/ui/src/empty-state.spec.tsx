import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { render } from "./test-helpers";

describe("EmptyState", () => {
  it("keeps the original markup without an illustration", () => {
    expect(render(<EmptyState title="Empty" />)).toBe(
      '<div class="flex flex-col items-center gap-2 p-8 text-center"><h2 class="text-lg font-semibold text-foreground">Empty</h2></div>',
    );
    expect(
      render(
        <EmptyState
          title="Empty"
          description="Description"
          headingAs="h3"
          className="mt-4"
          action={<a href="/catalog">Browse</a>}
        />,
      ),
    ).toBe(
      '<div class="flex flex-col items-center gap-2 p-8 text-center mt-4"><h3 class="text-lg font-semibold text-foreground">Empty</h3><p class="text-muted-foreground">Description</p><div class="mt-2"><a href="/catalog">Browse</a></div></div>',
    );
  });
  it("renders the optional illustration directly before the heading", () => {
    const illustration = <svg aria-hidden="true" focusable="false" />;
    const html = render(<EmptyState title="Empty" illustration={illustration} />);
    const original = render(<EmptyState title="Empty" />);
    expect(html).toBe(original.replace("<h2", `${render(illustration)}<h2`));
  });
});
