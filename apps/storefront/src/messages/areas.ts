/**
 * The ONE map of message namespaces (plan docs/plans/2026-11-08-design-changeability.md, WP3 M1). A key's namespace is the
 * text before its first dot (`site.name` -> `site`). For every namespace it says:
 * - `area`: the file the key lives in, `src/messages/<locale>/<area>.json` (`message-files.spec.ts` checks every key), or
 *   `null` for the one namespace upstream ships no file for: `custom`, a fork's own keys in `src/messages-extra/<locale>.json`;
 * - `client`: whether client components use it, so its keys are serialized into the page for the browser
 *   (`CLIENT_MESSAGE_PREFIXES` in `lib/client-messages.ts` is derived from this flag; server-only namespaces such as home
 *   sections and the footer stay out of the client payload).
 * A new namespace needs an entry here (the spec fails on a key without one). Pure data: no import, no React.
 */
export const MESSAGE_AREAS = [
  "shell",
  "home",
  "catalog",
  "product",
  "search",
  "cart",
  "checkout",
  "order",
  "payment",
  "account",
  "errors",
  "legal",
  "pages",
] as const;
export type MessageArea = (typeof MESSAGE_AREAS)[number];

export interface MessageNamespace {
  readonly area: MessageArea | null;
  readonly client: boolean;
}

/**
 * The reserved namespace of a client fork's OWN keys (owner decision 2026-11-09): `custom.<name>` in the fork-owned
 * `src/messages-extra/<locale>.json` (upstream ships `{}` and never adds a `custom.` key). A key outside it there is refused,
 * so an extra can never shadow an upstream key. `next.config.ts` repeats the name for the release check (a spec keeps them equal).
 */
export const CUSTOM_NAMESPACE = "custom";

export const MESSAGE_NAMESPACES = {
  // The page frame: name and title, skip link, header and footer navigation, language and theme switches, the loading,
  // error and not-found views, the page title pattern.
  site: { area: "shell", client: true },
  skip: { area: "shell", client: false },
  nav: { area: "shell", client: true },
  footer: { area: "shell", client: false },
  locale: { area: "shell", client: true },
  theme: { area: "shell", client: false },
  loading: { area: "shell", client: true },
  error: { area: "shell", client: true },
  notFound: { area: "shell", client: true },
  seo: { area: "shell", client: true },
  // Design batch A (plan 2026-11-03-storefront-design-a.md): the account pages' breadcrumbs, the trust bar and the funnel
  // steps are rendered by client islands (account layout, product page, cart, checkout, order pages).
  breadcrumbs: { area: "shell", client: true },
  trust: { area: "shell", client: true },
  funnel: { area: "shell", client: true },
  home: { area: "home", client: false },
  catalog: { area: "catalog", client: false },
  product: { area: "product", client: true },
  availability: { area: "product", client: true },
  // UX repairs batch 3A (plan 2026-11-06-ux-repairs-3-storefront.md): the product page's buy button before hydration and
  // its chosen values.
  productReady: { area: "product", client: true },
  productChoice: { area: "product", client: true },
  // The results page's own words stay server-side under `search.`; the header search box and the filter form are client.
  search: { area: "search", client: false },
  searchBox: { area: "search", client: true },
  searchForm: { area: "search", client: true },
  cart: { area: "cart", client: true },
  // UX repairs batch 3A: the cart's delivery note.
  cartDelivery: { area: "cart", client: true },
  checkout: { area: "checkout", client: true },
  order: { area: "order", client: true },
  payment: { area: "payment", client: true },
  account: { area: "account", client: true },
  // Problems from the API (`lib/problem-messages.ts`): codes, rules and field codes.
  errors: { area: "errors", client: true },
  legal: { area: "legal", client: false },
  // The information sentence at registration and checkout (`components/legal-notice.tsx`).
  notice: { area: "legal", client: true },
  shopPages: { area: "pages", client: false },
  contacts: { area: "pages", client: false },
  // A fork's own keys (`src/messages-extra`, no upstream area file). Client, so a fork's client component can use them; every
  // `custom.` key is then serialized into each page for the browser: that payload is the fork's to keep small.
  custom: { area: null, client: true },
} as const satisfies Record<string, MessageNamespace>;

/** The namespace of a key: the text before its first dot. */
export function namespaceOfKey(key: string): string {
  const dot = key.indexOf(".");
  return dot < 0 ? key : key.slice(0, dot);
}

/**
 * The area file a key belongs in, `null` for a `custom.` key (no upstream area file: a fork's extras), or `undefined` for a
 * namespace the map does not name.
 */
export function areaOfKey(key: string): MessageArea | null | undefined {
  const namespaces: Readonly<Record<string, MessageNamespace>> = MESSAGE_NAMESPACES;
  return Object.hasOwn(namespaces, namespaceOfKey(key))
    ? namespaces[namespaceOfKey(key)]?.area
    : undefined;
}
