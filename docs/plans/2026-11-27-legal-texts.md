# Plan: default legal texts for the storefront (2026-11-27)

Status: implemented (branch `feature/legal-texts`). Asked by the owner on 2026-11-27 (sales-readiness round, side session "legal texts").

**These are templates, not legal advice.** A lawyer reviews every text, the seller details and the retention periods before a
client launch (`docs/HANDOFF.md` section 3, "Legal and business"). The release check keeps refusing a client build until the
fork has filled the seller details and removed the review marker (below).

## Goal

Replace the one-line placeholders of `/{locale}/legal/privacy`, `/terms` and `/cookies` with realistic default texts of the
kind Ukrainian online shops publish, in `uk` (primary) and `en`:

1. Privacy policy (Політика конфіденційності).
2. Public offer, the terms of sale (Публічна оферта, договір купівлі-продажу).
3. Cookie policy (Політика щодо файлів cookie); the cookie page is also the cookie notice (no banner, see D5).

The texts describe what the template really does (sources below), never invent client data, and leave every seller-specific
value as a fill-in from config.

## Found (reuse, not reinvent)

- Pages: `apps/storefront/src/app/[locale]/(site)/legal/<slug>/page.tsx` via `lib/legal-route.tsx`, rendered by
  `components/legal-page.tsx` (intro, "Template placeholder" box while the intro carries the marker, cookie table, rights
  pointers, identity block). Config `src/config/legal.ts` (pages, cookie table), identity `src/config/legal-identity.json`
  (name, address, privacy contact, last-updated day). Messages `src/messages/<locale>/legal.json` (area `legal`, not sent to
  the browser; `notice.*` is).
- Section rendering exists for shop pages: `TextSection` and `paragraphsOf` (`config/shop-pages.ts`, `lib/shop-pages.ts`,
  `components/shop-page.tsx`): plain text, a blank line starts a paragraph, no HTML.
- Release check: `assertNoLegalPlaceholders` in `apps/storefront/next.config.ts` with `STOREFRONT_REQUIRE_LEGAL_TEXT=true`
  refuses a `legal.*` message with the marker, an unset identity field (`LEGAL_IDENTITY_FIELDS`), listed demo copy
  (`config/demo-content.json`). Contract: `docs/contracts/config.md`.
- Facts the texts rest on: `docs/privacy/README.md` (what is held, retention, requests, cookies and browser storage),
  `docs/privacy/data-inventory.md` (rows D1 to D26 with purpose and retention), `docs/privacy/processors.md` (Nova Post,
  Resend, Brevo, Monobank, LiqPay, the host), cookies `fluxkit_cart`, `fluxkit_customer_session` (API, `HttpOnly`),
  `fluxkit_admin_session` (staff only), `fluxkit_theme` (storefront, only after the shopper picks a theme, one year),
  `sessionStorage` checkout draft (one hour) and payment attempt keys, `localStorage` `fluxkit_demo_notice_seen` only with
  `STOREFRONT_DEMO_NOTICE=true`. No analytics, no advertising, no third-party scripts, only transactional mail.
- Shop pages already say "14 days" for returns (`shopPages.returns.*`, demo copy): the offer points at them, not repeats them.

## Decisions

- **D1 Structure.** Each legal page gets an ordered list of text sections in `config/legal.ts` (`legalSections`, same shape
  as the shop pages' `TextSection`: `id`, `titleKey`, `bodyKey`), messages `legal.<page>.section.<id>.title|body`. A fork
  drops, reorders or adds a section in that list and its messages; no component change. The existing intro stays the
  page's lead paragraph.
- **D2 Review flag (changed by the council, C2).** `config/demo-content.json` gets `legalTexts: ["privacy", "terms",
  "cookies"]`: the pages whose text is still the template default. The release check refuses while a slug is listed, the
  "default template text" box shows on a listed page, and a fork deletes the slug after its lawyer approved that page. Master's
  intros drop the marker; the marker check stays as a backstop (unchanged contract).
- **D3 Seller details.** `legal-identity.json` gains `shopTaxId` (ЄДРПОУ or РНОКПП), `shopEmail`, `shopPhone`; the name holds
  the legal form (`ФОП ...`, `ТОВ «...»`). The release check refuses each when unset (it already refuses the four existing
  fields). Texts use them as `{sellerName}`, `{sellerTaxId}`, `{sellerAddress}`, `{sellerEmail}`, `{sellerPhone}`,
  `{privacyEmail}` and `{website}` (the public origin); an unset value renders the visible unset wording.
  Approval: the owner's brief for this step requires fill-ins for exactly these details and a guard that keeps refusing
  them; the variable and its values are unchanged, only a build that already sets `true` refuses more (as in repair batch 2).
- **D4 Recipients.** The privacy text names recipient categories (hosting, carrier, payment provider, mail service) and the
  services the template can connect ("depending on what the shop uses: Nova Post; Monobank, LiqPay; Resend, Brevo"), so a
  fork trims a list rather than rewrites a section. Card data is entered on the payment provider's page and never reaches
  the shop.
- **D5 Cookie notice.** No banner: the shop sets only strictly necessary cookies and one preference cookie on request
  (ADR 0033 decision 11, ADR 0045). The cookie page is the notice; it also covers `sessionStorage`. A fork that adds analytics
  or advertising must add consent first (stated in `docs/customization.md`).
- **D6 Law references.** ЦКУ ст. 633, 634, 641, 642 (public contract, adhesion, offer, acceptance); ЗУ «Про електронну
  комерцію» by name; ЗУ «Про захист прав споживачів» by name only (whether Law No. 3153-IX of 2023 is in force yet is for the
  lawyer; the wording satisfies both regimes, C1);
  ЗУ «Про захист персональних даних»; GDPR "where it applies". Payment methods are generic ("the methods shown at checkout"),
  so WayForPay or cash on delivery need no text change beyond the delivery-and-payment page.
- **D7 Languages.** `uk` is the binding text; the `en` offer and privacy say the Ukrainian version prevails.

Council decisions on wording: section "Council" below.

## Files

- `apps/storefront/src/config/legal.ts`, `legal-identity.json`, `components/legal-page.tsx`, `next.config.ts`
  (`LEGAL_IDENTITY_FIELDS`), `messages/{uk,en}/legal.json`, specs next to them, e2e legal specs if they assert texts.
- Docs: `apps/storefront/README.md`, `docs/privacy/README.md`, `docs/contracts/config.md`, `docs/customization.md`,
  `docs/files/storefront.md` if a file is added, `CHANGELOG.md`, `docs/HANDOFF.md`.
- No API, schema, migration, dependency or environment variable change.

## Risks

- A fork with a filled identity file and `STOREFRONT_REQUIRE_LEGAL_TEXT=true` now fails until it adds the three new fields
  (CHANGELOG fork note).
- Visual comparison: legal pages change on purpose (per-PR `.visual/exceptions.json` if the job flags them).
- Legal accuracy: the texts are a reasonable default, not checked by a lawyer.

## Verification

`pnpm lint`, `pnpm typecheck`, storefront unit tests, legal e2e specs, `next build` with `STOREFRONT_REQUIRE_LEGAL_TEXT=true`
refusing on master (marker and unset seller details named) and passing with filled details and an override without the
marker; Codex QA review by a different model than the developer.

## Council (2026-11-27)

Three Claude agents, one lens each: Ukrainian consumer, e-commerce and personal-data law; template changeability (AGENTS.md
2.2, 15, 17); plain-language UX and Ukrainian copy. Decisions taken:

- **C1 Returns and citations (law lens).** The offer itself states the return right, not a link to the returns page (a fork may
  remove that page, and a referenced page becomes part of the contract): withdrawal within 14 days of receipt, refund within
  14 days of the return (meets both the 1991 law and Law No. 3153-IX), exceptions "as the consumer protection law sets"
  with goods made to order as the one example. Return shipping: corrected after QA (below), the seller pays. Laws other than
  ЦКУ are cited by title only. Payment providers and the carrier are "recipients", not "processors acting on our
  instructions" (a bank may be an independent controller). Legal bases: contract, legal obligation (accounting), legitimate
  interest (security); no consent today because nothing optional is processed. Complaints: Уповноважений Верховної Ради
  України з прав людини, and the EU supervisory authority where GDPR applies. Requests answered within 30 days. Never "by
  using the site you agree"; the session cookie is not called anonymous; the checkout draft in `sessionStorage` is disclosed.
- **C2 Review flag (changeability lens, adopted over the plan's first D2).** `legalTexts` in `demo-content.json` instead of the
  intro marker: the fork deletes one slug instead of copying an intro into an override that then drifts, and a fork that had
  put its whole text in an intro override now gets a refusing release build instead of silently shipping new template
  sections under its text (CHANGELOG fork note).
- **C3 Structure.** `legalSections: Record<LegalPageSlug, readonly TextSection[]>` reusing the shop pages' `TextSection` type,
  `paragraphsOf` and one shared paragraph view (no copy). Headings are numbered from the position in the list, never inside a
  message, and texts never cross-reference "section 5.2", so a fork can drop or reorder a section. Recipients are prose; the
  named services sit in their own message so a fork trims one string. Specs: unique section ids, keys in both locales, no
  unused `legal.*.section.*` key, every `{name}` in the supplied set, `legalTexts` only lists known slugs, guard names the new
  fields.
- **C4 Copy (UX lens).** Titles: «Політика конфіденційності», «Публічна оферта», «Політика щодо файлів cookie»; en "Privacy
  policy", "Terms of sale", "Cookie policy". Notice links: «умови публічної оферти» (accusative), «політиці
  конфіденційності» (locative); en "terms of sale", "privacy policy". Seller block «Реквізити продавця» / "Seller details" on
  every page; labels Продавець, Код ЄДРПОУ / РНОКПП, Адреса, Телефон, Електронна пошта, Питання щодо персональних даних (shown
  only when it differs from the seller email). Box: «Типовий текст: потрібна перевірка юриста». The offer keeps the legal
  style («Продавець», «Покупець», defined once); privacy and cookies speak as «ми/ви». Short paragraphs, «» quotes, the
  apostrophe ’ throughout. The en intros of the offer and the privacy policy say first that the Ukrainian text prevails.
- **Not taken now:** an in-page table of contents for the offer (UI addition; follow-up if the owner wants it); a note next
  to the theme switch about its one-year cookie; fixing the returns demo copy (`shopPages.returns.*`: "not used" and "a few
  days" fit the offline exchange regime, not distance withdrawal) is reported as a follow-up, the release check already
  refuses it as demo copy.

## Texts as written

- Keys: `apps/storefront/src/messages/{uk,en}/legal.json`. Privacy 9 sections plus the rights block, terms (public offer) 12,
  cookies 4 plus the table. Written by the Orchestrator from the facts above; no shop's text was copied. The named services
  (Nova Post, monobank, LiqPay, Resend, Brevo) are one paragraph of `legal.privacy.section.recipients.body`, so a fork trims one
  sentence (C3's own-message idea was not needed for that).
- The rights block's `legal.privacy.guests` and the sections use `{privacyEmail}`; every legal message gets the same values.

## Open questions for the lawyer (not decided by the template)

- Which consumer protection law is in force for the client (the 1991 law or Law No. 3153-IX), whether the 14-day refund
  should also include the original delivery cost, and whether the shop may put return shipping on the buyer (the default
  text has the seller pay it, which is allowed under either law) and exclude more goods (hygiene goods, digital content: only
  with the consent and information steps the law requires, which the template does not have).
- Whether the order email (items, totals, delivery, link; no terms version or seller details) satisfies the confirmation
  duty of the e-commerce law, or a durable copy of the terms must be sent.
- Minimum age (the text says 16, the stricter GDPR default) and whether a ФОП's РНОКПП and address may be published as is.
- Whether a consent checkbox is wanted at checkout (the template informs and relies on the contract, ADR 0033 decision 11).
- VAT status wording, the retention period to set in `ORDER_CONTACT_RETENTION_DAYS` (the privacy text promises one), the list
  of recipients and transfer countries actually used (`docs/privacy/processors.md`).

## QA review (2026-11-27, Codex gpt-6-astra; the Developer was gpt-6.1-sol)

Status CHANGES_REQUESTED, 7 major and 4 minor, no blocker. All fixed in this change:

- Guard: a `demo-content.json` without `legalTexts` passed the check and broke the page; the key is now required (`[]` once
  reviewed) and a missing key fails closed (regression test in `next.config.spec.ts`).
- Return shipping: under the 1991 law (still in force per the official database; Law No. 3153-IX's entry into force is for
  the lawyer) the seller bears it for distance contracts, so C1's "buyer pays" was wrong; the text now has the seller pay.
  The unconditional hygiene and digital-content exclusions were dropped (they need consent and information steps).
- Facts corrected: rate-limit counters (the default `memory` store keeps raw IPv4 keys; the text now says per IP, email or
  account, not in the database, each window ends within a day), the audit log scope (privacy-request steps only, not every
  customer view), the checkout draft (an hour-old draft is not restored and is deleted when next read, no timer), the order
  email (no longer called the confirmation of all terms), response times (10 working days to say, 30 calendar days to meet,
  one month under GDPR), transfers (SCCs or other safeguards and how to get a copy), the demo notice's `localStorage` flag.
- Retention promises (cart 30, sign-in 90, guest link 90 days, order contacts until the shop's period, limited backups) are
  the template's defaults and need the matching settings: `docs/customization.md` row 13 now says to align
  `CART_TTL_DAYS`, the session length, `ORDER_GUEST_ACCESS_DAYS`, `ORDER_CONTACT_RETENTION_DAYS` and the backup retention
  with the privacy text before removing `privacy` from `legalTexts`.
