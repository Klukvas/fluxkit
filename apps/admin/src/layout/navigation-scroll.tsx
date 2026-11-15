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
  const maximum = scrollHeight - clientHeight;
  return {
    above: maximum > 1 && scrollTop > 1,
    below: maximum > 1 && scrollTop < maximum - 1,
  };
}

export function revealDelta(
  item: Pick<DOMRect, "top" | "bottom">,
  viewport: Pick<DOMRect, "top" | "bottom">,
): number {
  if (item.top < viewport.top) return item.top - viewport.top;
  return Math.max(0, item.bottom - viewport.bottom);
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
  edges: { above, below },
  collapsed,
  t,
}: {
  edges: ScrollEdges;
  collapsed: boolean;
  t: Translator;
}) {
  const direction = below ? "below" : above ? "above" : "none";
  return (
    <div
      aria-hidden="true"
      data-nav-scroll-hint={direction}
      className="flex h-5 shrink-0 items-center justify-center gap-1 text-xs text-muted-foreground"
    >
      {(above || below) && (
        <>
          <ChevronIcon className={cn("size-4", !below && "rotate-180")} />
          {!collapsed && t(below ? "shell.navMoreBelow" : "shell.navMoreAbove")}
        </>
      )}
    </div>
  );
}
