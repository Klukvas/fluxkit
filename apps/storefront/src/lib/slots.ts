import type { Locale, Translator } from "@fluxkit/ui";
import { createElement, type ReactNode } from "react";
import type { ContactsView } from "./contacts";
import type { ProductCardModel } from "./product-card-model";

/**
 * The UI slots (plan 2026-11-08-design-changeability.md, S1; contract `docs/contracts/slots.md`). A fork lists SERVER components
 * per slot in its own `config/slots.tsx`; the template renders them at the slot's fixed place, in order, each with the slot's
 * plain view model (never an API object). With no components a slot renders nothing at all: no element, no byte.
 */

/** The props of every slot component: the page's locale and its translator (for the fork's `custom.` texts). */
export interface SlotBaseProps {
  locale: Locale;
  /** Keys of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`), or any template key. */
  t: Translator;
}

/** `header.top`: inside the header, above its row (an announcement bar, for example). */
export type HeaderTopSlotProps = SlotBaseProps;

/** `product-card.badges` and `product-card.actions`: on a built-in product card (`grid` or `list`). */
export interface ProductCardSlotProps extends SlotBaseProps {
  /** The card's plain view model (`cardDisplay`): id, title, localized link, price text, availability. */
  card: ProductCardModel;
  /** The card kind that renders the slot: `grid` or `list` (a fork's own card passes its own kind). */
  kind: string;
}

/** A link a slot component can render as it is: the text translated, the path localized. */
export interface SlotLink {
  label: string;
  href: string;
}

/** `footer.columns`: the columns at the top of the footer; the data of the template's footer blocks, ready to render. */
export interface FooterColumnsSlotProps extends SlotBaseProps {
  /** The shop pages with `inFooter` (`config/shop-pages.ts`). */
  shopLinks: readonly SlotLink[];
  /** The legal pages (`config/legal.ts`). */
  legalLinks: readonly SlotLink[];
  /** The shop's contacts (`config/contacts.ts`); `FooterContacts` of `components/contact-details.tsx` renders them. */
  contacts: ContactsView;
}

/** The props of each slot, by name. */
export interface SlotPropsByName {
  "header.top": HeaderTopSlotProps;
  "product-card.badges": ProductCardSlotProps;
  "product-card.actions": ProductCardSlotProps;
  "footer.columns": FooterColumnsSlotProps;
}

export type SlotName = keyof SlotPropsByName;

/** Every slot of the contract, in the order of the page. */
export const SLOT_NAMES = [
  "header.top",
  "product-card.badges",
  "product-card.actions",
  "footer.columns",
] as const satisfies readonly SlotName[];

/** A SERVER component (it may be `async`); returning `null` shows nothing. */
export type SlotComponent<Name extends SlotName> = (props: SlotPropsByName[Name]) => ReactNode;

/** The components of each slot, in order. A name outside `SlotName` is a type error. */
export type SlotRegistry = { readonly [Name in SlotName]?: readonly SlotComponent<Name>[] };

/** What a `'use client'` module's export is on the server: a reference the server can pass on, never call with a translator. */
function isClientReference(component: unknown): boolean {
  return (
    typeof component === "function" &&
    (component as { $$typeof?: unknown }).$$typeof === Symbol.for("react.client.reference")
  );
}

const knownNames: ReadonlySet<string> = new Set(SLOT_NAMES);

/** Unknown names already reported in this process: a production server logs each once, not on every render. */
const reportedUnknownNames = new Set<string>();

/**
 * Checks the whole registry on every slot render, so a wrong entry is found on every page (the header renders `header.top` on
 * each). An unknown name (a typo, a slot that does not exist) throws in development and tests; in production it is left out and
 * reported with `console.error` once per name and server process, while the known slots render. Never silent.
 */
function checkNames(registry: SlotRegistry): void {
  for (const name of Object.keys(registry)) {
    if (knownNames.has(name)) continue;
    const message = `config/slots.tsx registers the unknown slot "${name}" (slots: ${SLOT_NAMES.join(", ")}).`;
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    if (!reportedUnknownNames.has(name)) {
      reportedUnknownNames.add(name);
      console.error(`${message} Its components are left out.`);
    }
  }
}

/**
 * The components of one slot, checked. Besides the names (`checkNames`), an entry that cannot render throws in every
 * environment: a value that is not a list, a list item that is not a function, and a client component registered directly (it
 * could not receive the translator: functions do not cross to the browser; register a server component that renders the island
 * with plain props).
 */
export function slotComponents<Name extends SlotName>(
  name: Name,
  registry: SlotRegistry,
): readonly SlotComponent<Name>[] {
  checkNames(registry);
  // Own entries only: an inherited member must not count as a registration.
  const components = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (components === undefined) return [];
  if (!Array.isArray(components)) {
    throw new Error(`config/slots.tsx: the slot "${name}" is not a list of components.`);
  }
  components.forEach((component: unknown, index) => {
    if (typeof component !== "function") {
      throw new Error(
        `config/slots.tsx: entry ${String(index + 1)} of the slot "${name}" is not a component.`,
      );
    }
    if (isClientReference(component)) {
      throw new Error(
        `config/slots.tsx: entry ${String(index + 1)} of the slot "${name}" is a client component ('use client'); register a server component that renders it with plain props.`,
      );
    }
  });
  return components;
}

/**
 * The elements of one slot, in order, each given `props`, or `null` when the slot has no components. The caller places them
 * (with its frame only when this is not `null`), so an empty slot adds no node to the markup and no entry to the page's React
 * payload. No `Suspense` and no error boundary around them (ADR 0048; `docs/contracts/slots.md`, "Errors").
 */
export function renderSlot<Name extends SlotName>(
  name: Name,
  props: SlotPropsByName[Name],
  registry: SlotRegistry,
): ReactNode[] | null {
  const components = slotComponents(name, registry);
  if (components.length === 0) return null;
  return components.map((component, index) =>
    createElement(component as (props: SlotPropsByName[Name]) => ReactNode, {
      ...props,
      key: index,
    }),
  );
}
