import type { Locale, Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import type { CustomSection, HomeSectionWidth } from "../config/home";

/**
 * The contract of a `custom` home section (plan 2026-11-08-design-changeability.md, L4; `docs/contracts/home-sections.md`).
 * A fork maps names to SERVER components in its own `config/custom-sections.ts`; `config/home.ts` places them by name. The
 * component receives this plain view model, never an API object: what it needs beyond that it reads itself, on the server.
 */
export interface CustomSectionProps {
  /** The section's `id` from `config/home.ts` (unique on the page). */
  id: string;
  /** `<id>-title`: give the section's heading this id and label the section with it (`aria-labelledby`). */
  headingId: string;
  locale: Locale;
  /** For the section's own texts: keys of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`). */
  t: Translator;
  /**
   * The first section of the page: its pictures are above the fold and load at once. The page's `h1` is then a visually
   * hidden one, so the section's heading stays an `h2`.
   */
  isFirst: boolean;
  /**
   * `contained`: the page puts the section in its content width. `full`: the section spans the window, without a container;
   * it chooses its own surface (token classes such as `bg-muted`) and keeps its content readable (for example inside
   * `Container` of `@fluxkit/ui`).
   */
  width: HomeSectionWidth;
}

/** A server component (it may be `async`). It returns `null` to show nothing; the section then takes no space. */
export type CustomSectionComponent = (props: CustomSectionProps) => ReactNode;

/** Components by the `name` of a `custom` section. */
export type CustomSectionRegistry = Readonly<Record<string, CustomSectionComponent>>;

/** What a `'use client'` module's export is on the server: a reference the server can pass on, never call with a translator. */
function isClientReference(component: unknown): boolean {
  return (
    typeof component === "function" &&
    (component as { $$typeof?: unknown }).$$typeof === Symbol.for("react.client.reference")
  );
}

/** Names already reported in this process: a production server logs each unknown name once, not on every render. */
const reportedUnknownNames = new Set<string>();

/**
 * The component of a `custom` section. A name the registry does not know (a typo, a removed component) throws in development
 * and tests, so it is seen at once (`next dev` shows the error); in production the section is left out and reported with
 * `console.error` (once per name and server process), while the rest of the page renders. Never silent.
 *
 * Why not fall back like `resolveCard` (cards registry): an unknown card kind still has an obvious stand-in (the `grid` card
 * shows the same products), so the shopper loses nothing. An unknown custom section has no stand-in: rendering anything else
 * would show content nobody configured, so development fails and production leaves the section out.
 *
 * A client component registered directly always throws: it could not receive the translator (functions do not cross to the
 * browser), so a fork registers a server component that renders its island with plain, already translated props.
 */
export function resolveCustomSection(
  section: CustomSection,
  registry: CustomSectionRegistry,
): CustomSectionComponent | null {
  // Own entries only: a name such as "toString" must not resolve to an Object.prototype member.
  const component = Object.hasOwn(registry, section.name) ? registry[section.name] : undefined;
  if (component === undefined) {
    const registered = Object.keys(registry);
    const message = `Home section "${section.id}" names the custom section "${section.name}", which config/custom-sections.ts does not register (registered: ${registered.length === 0 ? "none" : registered.join(", ")}).`;
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    if (!reportedUnknownNames.has(section.name)) {
      reportedUnknownNames.add(section.name);
      console.error(`${message} The section is left out.`);
    }
    return null;
  }
  if (isClientReference(component)) {
    throw new Error(
      `The custom section "${section.name}" is a client component ('use client'); register a server component that renders it with plain props.`,
    );
  }
  return component;
}
