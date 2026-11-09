"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element is in the viewport (IntersectionObserver), `null` until the first observation. `selector` finds the
 * element in the document instead of a ref (the site footer, outside the island). Without `IntersectionObserver` it stays
 * `null`, so whatever depends on it stays in its safe state (the buy bar hidden).
 */
export function useInView(
  target: RefObject<Element | null> | string,
  enabled = true,
): boolean | null {
  const [inView, setInView] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const element = typeof target === "string" ? document.querySelector(target) : target.current;
    if (element === null) {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) setInView(last.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, enabled]);
  return inView;
}

/** Whether `query` matches (`matchMedia`), `false` on the server and before the first effect (so hydration matches). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Below Tailwind's `md`: the widths where the product page shows the buy bar. */
export const PHONE_QUERY = "(max-width: 47.99rem)";

export interface StickyBuyBarProps {
  visible: boolean;
  price: string | null;
  /** The chosen values ("Black, S"), or the reason the button is off (the line limit, out of stock). */
  note: string;
  quantity: number;
  min: number;
  max: number;
  canAdd: boolean;
  addLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
  onQuantity: (quantity: number) => void;
  onAdd: () => void;
}

const stepButton =
  "inline-flex size-11 items-center justify-center rounded-control border border-border bg-background text-foreground disabled:opacity-50";

/**
 * The product page's buy bar on phones (review D-02): fixed to the bottom below `md`, shown only while the inline "Add to
 * cart" is out of view (`buyBarShown`). It is a pointer shortcut, like the filters' floating Apply (PR 211): hidden from
 * assistive technology and out of the tab order, because the inline form stays the one control for keyboards and screen
 * readers (focusing it scrolls it into view, which hides the bar). Its buttons act on the same state and submit the same
 * form, so every rule of the inline block (stock, line limit, pending) holds here too. Fixed, so it never moves the page.
 */
export function StickyBuyBar(props: StickyBuyBarProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="buy-bar"
      className={`fk-bottom-bar fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 pt-3 shadow-card motion-safe:transition-transform md:hidden ${
        props.visible ? "translate-y-0" : "invisible translate-y-full"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {props.price === null ? null : (
            <span className="font-semibold whitespace-nowrap text-foreground tabular-nums">
              {props.price}
            </span>
          )}
          <span className="truncate text-sm text-muted-foreground">{props.note}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            tabIndex={-1}
            aria-label={props.decreaseLabel}
            className={stepButton}
            disabled={!props.canAdd || props.quantity <= props.min}
            onClick={() => props.onQuantity(props.quantity - 1)}
          >
            &minus;
          </button>
          <span className="min-w-8 text-center text-foreground tabular-nums">{props.quantity}</span>
          <button
            type="button"
            tabIndex={-1}
            aria-label={props.increaseLabel}
            className={stepButton}
            disabled={!props.canAdd || props.quantity >= props.max}
            onClick={() => props.onQuantity(props.quantity + 1)}
          >
            +
          </button>
        </div>
      </div>
      <button
        type="button"
        tabIndex={-1}
        disabled={!props.canAdd}
        onClick={props.onAdd}
        className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-control bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
      >
        {props.addLabel}
      </button>
    </div>
  );
}
