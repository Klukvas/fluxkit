import { afterEach, describe, expect, it, vi } from "vitest";
import { createToastClock, Toast, ToastStack } from "./toast";
import { appendToast, createToastTimer } from "./toast-timer";
import { first, render, tags, text } from "./test-helpers";

afterEach(() => vi.useRealTimers());

describe("Toast reading clock", () => {
  it("dismisses when its reading lifetime elapses", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    createToastTimer(5000, dismiss);
    vi.advanceTimersByTime(4999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("pauses on hover/focus and resumes only the remaining time after both leave", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = createToastTimer(5000, dismiss);
    vi.advanceTimersByTime(1200);
    timer.pause("hover");
    timer.pause("focus");
    vi.advanceTimersByTime(8000);
    expect(timer.remaining()).toBe(3800);
    timer.resume("hover");
    vi.advanceTimersByTime(8000);
    expect(dismiss).not.toHaveBeenCalled();
    timer.resume("focus");
    vi.advanceTimersByTime(3799);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("ignores duplicate holds and cancels immediately on disposal", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const timer = createToastTimer(5000, dismiss);
    timer.pause("focus");
    timer.pause("focus");
    timer.resume("focus");
    vi.advanceTimersByTime(1000);
    expect(timer.remaining()).toBe(4000);
    timer.dispose();
    vi.advanceTimersByTime(5000);
    expect(dismiss).not.toHaveBeenCalled();
  });
  it("keeps the newest three without a queue", () => {
    expect(appendToast([1, 2, 3], 4)).toEqual([2, 3, 4]);
  });
});

describe("Toast life bar clock", () => {
  it("animates from the reading lifetime and pauses until both hover and focus leave", () => {
    vi.useFakeTimers();
    const animation = { pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
    const animate = vi
      .fn<HTMLElement["animate"]>()
      .mockReturnValue(animation as unknown as Animation);
    const bar = { animate, hidden: false };
    const dismiss = vi.fn();
    const clock = createToastClock(bar, 5000, dismiss, false);
    expect(animate).toHaveBeenCalledWith([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
      duration: 5000,
      fill: "forwards",
    });
    vi.advanceTimersByTime(1200);
    clock.pause("hover");
    clock.pause("hover");
    clock.pause("focus");
    expect(animation.pause).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(8000);
    clock.resume("hover");
    clock.resume("hover");
    expect(animation.play).not.toHaveBeenCalled();
    expect(clock.remaining()).toBe(3800);
    clock.resume("focus");
    expect(animation.play).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3799);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
    clock.dispose();
    expect(animation.cancel).toHaveBeenCalledOnce();
  });
  it("hides the bar under reduced motion while retaining the full reading lifetime", () => {
    vi.useFakeTimers();
    const bar = { animate: vi.fn<HTMLElement["animate"]>(), hidden: false };
    const dismiss = vi.fn();
    const clock = createToastClock(bar, 5000, dismiss, true);
    expect(bar.hidden).toBe(true);
    expect(bar.animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
    clock.dispose();
  });
  it("works without Element.animate and cancels the timer on unmount", () => {
    vi.useFakeTimers();
    // Older browsers and DOM test environments may not implement Web Animations.
    const bar = { hidden: false } as Pick<HTMLElement, "animate" | "hidden">;
    const dismiss = vi.fn();
    const clock = createToastClock(bar, 5000, dismiss, false);
    expect(bar.hidden).toBe(true);
    clock.pause("focus");
    clock.resume("focus");
    clock.dispose();
    vi.advanceTimersByTime(5000);
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("Toast views", () => {
  it("keeps the polite region and its list mounted when empty", () => {
    const markup = render(<ToastStack />);
    expect(first(markup, "div").attributes.role).toBe("status");
    expect(first(markup, "div").attributes["aria-live"]).toBe("polite");
    expect(tags(markup, "ul")).toHaveLength(1);
    expect(markup).toContain("pointer-events-none");
  });
  it("renders message, action, immediate dismiss and decorative life bar", () => {
    const markup = render(
      <Toast
        message="Could not add"
        tone="danger"
        dismissLabel="Dismiss"
        lifetime={5000}
        onDismiss={() => undefined}
        action={<a href="/cart">View cart</a>}
      />,
    );
    expect(first(markup, "li").attributes.class).toContain("pointer-events-auto");
    expect(markup).toContain("border-danger");
    expect(first(markup, "button").attributes["aria-label"]).toBe("Dismiss");
    expect(markup).not.toContain("style=");
    expect(first(markup, "p").attributes.class ?? "").not.toContain("text-danger");
    expect(first(markup, "li").attributes.class).toContain("text-foreground");
    expect(markup).toContain("bg-danger");
    expect(text(markup)).toBe("Could not add View cart");
  });
});
