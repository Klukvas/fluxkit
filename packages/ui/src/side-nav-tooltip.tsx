"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** A top-layer label: the independently scrolling sidebar cannot clip it. */
export function SideNavTooltip({ label, children }: { label: string; children: ReactNode }) {
  const trigger = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useTooltipPosition(open, trigger, tooltip, setOpen);
  const closeIfOutside = (target: EventTarget | null) => {
    if (!(target instanceof Node) || !trigger.current?.contains(target)) setOpen(false);
  };
  return (
    <div
      ref={trigger}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={(event) => {
        if (!trigger.current?.contains(document.activeElement)) closeIfOutside(event.relatedTarget);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!trigger.current?.matches(":hover")) closeIfOutside(event.relatedTarget);
      }}
    >
      {children}
      <span
        ref={tooltip}
        popover="manual"
        aria-hidden="true"
        className="fixed inset-auto m-0 border-0 bg-transparent p-0"
      >
        <span className="block rounded-control border border-border bg-background px-3 py-2 text-sm text-foreground shadow-overlay">
          {label}
        </span>
      </span>
    </div>
  );
}

function useTooltipPosition(
  open: boolean,
  trigger: RefObject<HTMLDivElement | null>,
  tooltip: RefObject<HTMLSpanElement | null>,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return;
    const anchor = trigger.current;
    const popup = tooltip.current;
    if (!anchor || !popup) return;
    popup.showPopover();
    const close = () => setOpen(false);
    const position = () => positionTooltip(anchor, popup, close);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    document.addEventListener("keydown", dismiss);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      document.removeEventListener("keydown", dismiss);
      popup.hidePopover();
    };
  }, [open, trigger, tooltip, setOpen]);
}

function positionTooltip(anchor: HTMLElement, popup: HTMLElement, close: () => void): void {
  if (anchor.getClientRects().length === 0) {
    close();
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const rtl = getComputedStyle(anchor).direction === "rtl";
  const { width, height } = popup.getBoundingClientRect();
  const inlineEnd = rtl ? rect.left - width : rect.right;
  popup.style.left = `${Math.max(0, Math.min(inlineEnd, document.documentElement.clientWidth - width))}px`;
  popup.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - height))}px`;
}
