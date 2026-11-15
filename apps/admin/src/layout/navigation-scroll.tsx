import { ChevronIcon, cn, type Translator } from "@fluxkit/ui";
import { useEffect, useState, type RefObject } from "react";

interface ScrollEdges {
  above: boolean;
  below: boolean;
}

/** Ignore subpixel rounding at either end, including browser overscroll. */
export function scrollEdges({
  scrollTop,
  clientHeight,
  scrollHeight,
}: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">): ScrollEdges {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  const position = Math.max(0, Math.min(scrollTop, maximum));
  return { above: position > 1, below: maximum - position > 1 };
}

export function revealDelta(
  item: Pick<DOMRect, "top" | "bottom">,
  viewport: Pick<DOMRect, "top" | "bottom">,
): number {
  if (item.top < viewport.top) return item.top - viewport.top;
  if (item.bottom > viewport.bottom) return item.bottom - viewport.bottom;
  return 0;
}

/** Reveal only inside this sidebar: never move document scroll or keyboard focus. */
export function useNavigationScroll(
  ref: RefObject<HTMLDivElement | null>,
  pathname?: string,
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ above: false, below: false });
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const update = () => {
      const next = scrollEdges(box);
      setEdges((previous) =>
        previous.above === next.above && previous.below === next.below ? previous : next,
      );
    };
    const reveal = () => {
      const current = box.querySelector('a[aria-current="page"]');
      if (current && box.clientHeight !== 0) {
        const top = box.getBoundingClientRect().top + box.clientTop;
        box.scrollTop += revealDelta(current.getBoundingClientRect(), {
          top,
          bottom: top + box.clientHeight,
        });
      }
      update();
    };
    reveal();
    box.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(reveal);
    observer.observe(box);
    // Feature links can grow the nav without resizing its scroll box.
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => {
      box.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref, pathname]);
  return edges;
}

export function NavigationScrollHint({
  edges,
  collapsed,
  t,
}: {
  edges: ScrollEdges;
  collapsed: boolean;
  t: Translator;
}) {
  const direction = edges.below ? "below" : edges.above ? "above" : "none";
  return (
    <div
      aria-hidden="true"
      data-nav-scroll-hint={direction}
      className="flex h-5 shrink-0 items-center justify-center gap-1 text-xs text-muted-foreground"
    >
      {direction !== "none" ? (
        <>
          <ChevronIcon className={cn("size-4", direction === "above" && "rotate-180")} />
          {collapsed
            ? null
            : t(direction === "below" ? "shell.navMoreBelow" : "shell.navMoreAbove")}
        </>
      ) : null}
    </div>
  );
}
