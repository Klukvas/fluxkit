import type { Locale, Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import type { ProductCardModel } from "../../lib/product-card-model";

/**
 * The contract of a product card kind (plan 2026-11-08-design-changeability.md, L2; `docs/contracts/card-registry.md`). A
 * card is a SERVER component that renders a plain view model (`ProductCardModel`, built by `cardDisplay`), never an API
 * object: what the card shows is decided before it is called.
 */
export interface CardProps {
  card: ProductCardModel;
  /** Heading level of the product title: the card sits under an h1 (`h2`) or under a section's h2 (`h3`). */
  headingLevel: "h2" | "h3";
  /** Among the first cards of a list: the image loads at once, with high priority. */
  eager: boolean;
  locale: Locale;
  /** For a card's OWN extra text (keys of the fork's `custom.` namespace); the model's texts are already translated. */
  t: Translator;
}

export type CardComponent = (props: CardProps) => ReactNode;

/** One registered kind: the card and how a list of such cards is laid out. */
export interface CardKindEntry {
  Card: CardComponent;
  /**
   * Classes of the list (`<ul>`) holding cards of this kind, as LITERAL Tailwind classes (Tailwind only generates classes it
   * finds written out in the source; arbitrary values are refused by the design guard).
   */
  listClassName: string;
  /** At most this many leading images of a list load eagerly (the first visible row). */
  maxEagerImages: number;
}

/** Kinds by name: `grid` and `list` ship with the template; a fork adds or overrides kinds in `cards/custom.ts`. */
export type CardRegistry = Readonly<Record<string, CardKindEntry>>;
