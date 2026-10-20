"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";
import { nextTabIndex } from "./tab-navigation";

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  /** Accessible name of the tablist. */
  label: string;
  tabs: TabItem[];
  selectedId: string;
  onChange: (id: string) => void;
  /** Content of the selected tab. Only that panel exists in the markup. */
  children: ReactNode;
}

/**
 * WAI-ARIA tabs with automatic activation: arrows, Home and End move the focus and select (roving tabindex, so the
 * tablist is one tab stop). Controlled. Client component: the keyboard handler moves the focus.
 */
export function Tabs({ label, tabs, selectedId, onChange, children }: TabsProps) {
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.id === selectedId);
  // An unknown selected id must not leave the tablist without a tab stop.
  const tabStop = selectedIndex >= 0 ? selectedIndex : tabs.findIndex((tab) => !tab.disabled);
  const tabId = (id: string): string => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const target = nextTabIndex(
      index,
      event.key,
      tabs.map((tab) => tab.disabled === true),
    );
    const next = target === null ? undefined : tabs[target];
    if (target === null || !next) {
      return;
    }
    event.preventDefault();
    buttons.current[target]?.focus();
    // Always ask for the tab the focus moved to, even when it looks selected already: `selectedId` is the value of the
    // last render, and a parent that updates asynchronously (the admin's router changes the query string) may still be
    // switching away from it. Comparing with it dropped the second of two fast key presses, leaving the focus on one tab
    // and another selected (found by the admin keyboard e2e scenario). A click asks the same way.
    onChange(next.id);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {tabs.map((tab, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "min-h-11 border-b-2 px-4 py-2 font-medium disabled:opacity-50",
                focusRing,
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={selectedIndex >= 0 ? tabId(selectedId) : undefined}
        tabIndex={0}
        className={cn("py-4", focusRing)}
      >
        {children}
      </div>
    </div>
  );
}
