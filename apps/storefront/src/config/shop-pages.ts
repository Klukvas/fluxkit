/**
 * The shop's information pages (repair batch 2, plan docs/plans/2026-11-06-storefront-shop-pages.md): delivery and payment,
 * returns, FAQ, about, size guide and contacts. Internal to the storefront, like `legal.ts` and `home.ts`: a client fork edits
 * THIS list and the `shopPages.*` messages (uk and en in `src/messages`), no component. One route renders every page
 * (`app/[locale]/(pages)/[page]/page.tsx`, URL `/{locale}/<slug>`); a slug that is not listed here is a real 404.
 *
 * Turning a page off = removing its entry: its route, footer link, product-page link, sitemap entry and every "see also" link
 * disappear with it. Texts are message keys, never literal strings; a table cell may hold a language-neutral `value` (a size,
 * a number) instead. `lib/shop-pages.ts` checks the list (unique slugs and ids, no slug of another route, table shapes) and
 * `config/shop-pages.spec.ts` runs that check in CI.
 *
 * The texts of master are DEMO copy (`config/demo-content.json` lists every page; `STOREFRONT_REQUIRE_LEGAL_TEXT=true` refuses a
 * release build until the fork removed the slug there after writing its own texts). They describe what the template really
 * does (guest checkout, online payment on the order page, tracking on the order page) where they can; delivery times, prices
 * and return periods are examples the shop must replace.
 *
 * The delivery and payment page must match the checkout: its rows and texts name only the shipping methods that are ACTIVE
 * (admin, Shipping) and the payment methods that are enabled (`PAYMENT_PROVIDERS_ENABLED`). Nothing checks this at runtime:
 * whoever activates or switches off a method edits the page in the same change.
 */

/**
 * The pages the template knows, enabled or not. A fork that adds a page adds its slug here (and to `demo-content.json` while it
 * is demo copy). A "See also" link must name one of these (`checkShopPages`); a known page that is not in `shopPages` is
 * simply left out of the links.
 */
export const knownShopPageSlugs = [
  "delivery-and-payment",
  "returns",
  "faq",
  "about",
  "size-guide",
  "contacts",
] as const;

export type ShopPageSlug = (typeof knownShopPageSlugs)[number];

/** Paragraphs: the message is plain text, a blank line starts a new paragraph. No HTML. */
export interface TextSection {
  kind: "text";
  /** Unique on the page: the heading's `id`. */
  id: string;
  titleKey?: string;
  bodyKey: string;
}

/** A cell: a message key, or a language-neutral value shown as is (a size, a measurement). */
export type TableCell = { key: string } | { value: string };

/** A table: the delivery methods, a size chart. Every row has one cell per column; the first cell heads its row. */
export interface TableSection {
  kind: "table";
  id: string;
  titleKey: string;
  /** Accessible caption (visually hidden: the heading says the same for sighted shoppers). */
  captionKey: string;
  columnKeys: readonly string[];
  rows: readonly (readonly TableCell[])[];
  /** Optional text under the table (a note on how to measure, on the prices). */
  noteKey?: string;
}

/** Questions and answers, each a closed native disclosure (keyboard and find-in-page work without a script). */
export interface FaqSection {
  kind: "faq";
  id: string;
  /** With a title the questions are `h3` under it; without one they are `h2`. */
  titleKey?: string;
  items: readonly { id: string; questionKey: string; answerKey: string }[];
}

/** The shop's contacts from `config/contacts.ts` (nothing when every contact is empty). */
export interface ContactsSection {
  kind: "contacts";
  id: string;
  titleKey?: string;
}

/** Links to other shop pages ("See also"); a page that is not enabled is left out, an empty list hides the section. */
export interface LinksSection {
  kind: "links";
  id: string;
  titleKey: string;
  pages: readonly ShopPageSlug[];
}

export type ShopPageSection =
  TextSection | TableSection | FaqSection | ContactsSection | LinksSection;

export interface ShopPageConfig {
  slug: ShopPageSlug;
  /** The `h1`, the breadcrumb, the `<title>` and every link to the page. */
  titleKey: string;
  /** The meta description and the lead paragraph under the `h1`. */
  descriptionKey: string;
  /** Linked from the footer of every page (the footer has a size budget: README, "Keep the header small"). */
  inFooter: boolean;
  sections: readonly ShopPageSection[];
}

/**
 * TODO(fluxkit): demo copy (`demo-content.json`). The enabled pages, in footer order.
 */
export const shopPages: readonly ShopPageConfig[] = [
  {
    slug: "delivery-and-payment",
    titleKey: "shopPages.delivery.title",
    descriptionKey: "shopPages.delivery.description",
    inFooter: true,
    sections: [
      {
        kind: "table",
        id: "delivery-methods",
        titleKey: "shopPages.delivery.methods.title",
        captionKey: "shopPages.delivery.methods.caption",
        columnKeys: [
          "shopPages.delivery.methods.column.method",
          "shopPages.delivery.methods.column.time",
          "shopPages.delivery.methods.column.cost",
        ],
        // One row per delivery method the shop REALLY offers at checkout (admin, Shipping: the active methods); a row for a
        // method the checkout does not offer reads like a broken promise (UX round 2, batch 3A item 2). The template's demo
        // offers the courier only (`demo_courier` of the seed); a fork adds a row (and its `shopPages.delivery.methods.<id>.*`
        // messages) for every method it activates, e.g. a carrier branch or store pickup, and removes the ones it switches off.
        rows: [
          [
            { key: "shopPages.delivery.methods.courier.method" },
            { key: "shopPages.delivery.methods.courier.time" },
            { key: "shopPages.delivery.methods.courier.cost" },
          ],
        ],
        noteKey: "shopPages.delivery.methods.note",
      },
      // The payment text names only what the checkout offers: online payment by card on the order page (ADR 0032). A fork with
      // another method (cash on delivery, a bank transfer) changes `shopPages.delivery.payment.body` with it.
      {
        kind: "text",
        id: "payment",
        titleKey: "shopPages.delivery.payment.title",
        bodyKey: "shopPages.delivery.payment.body",
      },
      {
        kind: "text",
        id: "tracking",
        titleKey: "shopPages.delivery.tracking.title",
        bodyKey: "shopPages.delivery.tracking.body",
      },
    ],
  },
  {
    slug: "returns",
    titleKey: "shopPages.returns.title",
    descriptionKey: "shopPages.returns.description",
    inFooter: true,
    sections: [
      {
        kind: "text",
        id: "returns-conditions",
        titleKey: "shopPages.returns.conditions.title",
        bodyKey: "shopPages.returns.conditions.body",
      },
      {
        kind: "text",
        id: "returns-how",
        titleKey: "shopPages.returns.how.title",
        bodyKey: "shopPages.returns.how.body",
      },
      {
        kind: "text",
        id: "returns-exceptions",
        titleKey: "shopPages.returns.exceptions.title",
        bodyKey: "shopPages.returns.exceptions.body",
      },
      {
        kind: "links",
        id: "returns-see-also",
        titleKey: "shopPages.seeAlso",
        pages: ["contacts", "faq"],
      },
    ],
  },
  {
    slug: "faq",
    titleKey: "shopPages.faq.title",
    descriptionKey: "shopPages.faq.description",
    inFooter: true,
    sections: [
      {
        kind: "faq",
        id: "faq-questions",
        items: [
          {
            id: "order",
            questionKey: "shopPages.faq.order.question",
            answerKey: "shopPages.faq.order.answer",
          },
          {
            id: "status",
            questionKey: "shopPages.faq.status.question",
            answerKey: "shopPages.faq.status.answer",
          },
          {
            id: "payment",
            questionKey: "shopPages.faq.payment.question",
            answerKey: "shopPages.faq.payment.answer",
          },
          {
            id: "delivery",
            questionKey: "shopPages.faq.delivery.question",
            answerKey: "shopPages.faq.delivery.answer",
          },
          {
            id: "cancel",
            questionKey: "shopPages.faq.cancel.question",
            answerKey: "shopPages.faq.cancel.answer",
          },
          {
            id: "returns",
            questionKey: "shopPages.faq.returns.question",
            answerKey: "shopPages.faq.returns.answer",
          },
        ],
      },
      {
        kind: "links",
        id: "faq-see-also",
        titleKey: "shopPages.seeAlso",
        pages: ["delivery-and-payment", "returns", "size-guide", "contacts"],
      },
    ],
  },
  {
    slug: "about",
    titleKey: "shopPages.about.title",
    descriptionKey: "shopPages.about.description",
    inFooter: true,
    sections: [
      {
        kind: "text",
        id: "about-who",
        titleKey: "shopPages.about.who.title",
        bodyKey: "shopPages.about.who.body",
      },
      {
        kind: "text",
        id: "about-promise",
        titleKey: "shopPages.about.promise.title",
        bodyKey: "shopPages.about.promise.body",
      },
    ],
  },
  {
    slug: "size-guide",
    titleKey: "shopPages.sizeGuide.title",
    descriptionKey: "shopPages.sizeGuide.description",
    inFooter: false,
    sections: [
      {
        kind: "table",
        id: "size-chart",
        titleKey: "shopPages.sizeGuide.chart.title",
        captionKey: "shopPages.sizeGuide.chart.caption",
        columnKeys: [
          "shopPages.sizeGuide.chart.column.size",
          "shopPages.sizeGuide.chart.column.chest",
          "shopPages.sizeGuide.chart.column.waist",
        ],
        rows: [
          [{ value: "XS" }, { value: "80–84" }, { value: "64–68" }],
          [{ value: "S" }, { value: "88–92" }, { value: "72–76" }],
          [{ value: "M" }, { value: "96–100" }, { value: "80–84" }],
          [{ value: "L" }, { value: "104–108" }, { value: "88–92" }],
          [{ value: "XL" }, { value: "112–116" }, { value: "96–100" }],
        ],
        noteKey: "shopPages.sizeGuide.chart.note",
      },
      {
        kind: "text",
        id: "size-measure",
        titleKey: "shopPages.sizeGuide.measure.title",
        bodyKey: "shopPages.sizeGuide.measure.body",
      },
    ],
  },
  {
    slug: "contacts",
    titleKey: "shopPages.contacts.title",
    descriptionKey: "shopPages.contacts.description",
    inFooter: true,
    sections: [
      {
        kind: "contacts",
        id: "contacts-details",
        titleKey: "shopPages.contacts.details.title",
      },
      {
        kind: "text",
        id: "contacts-answers",
        titleKey: "shopPages.contacts.answers.title",
        bodyKey: "shopPages.contacts.answers.body",
      },
    ],
  },
];

/**
 * The note under the product page's buy box: the delivery page's one-line summary and links to these pages (the ones that are
 * enabled). `null` hides it; no enabled page hides it too.
 */
export const productPageNote: {
  titleKey: string;
  summaryKey: string;
  pages: readonly ShopPageSlug[];
} | null = {
  titleKey: "shopPages.productNote.title",
  summaryKey: "shopPages.delivery.summary",
  pages: ["delivery-and-payment", "returns"],
};
