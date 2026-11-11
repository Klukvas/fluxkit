# Storefront "my orders": the link back to the account matches the other account pages

Written against: `a3f78cd4` (`main`). Source: finding 1 of `docs/plans/2026-11-11-improve-ui-audit-2.md`, selected by the owner on 2026-11-11.

## Evidence chain

- Surface: storefront `/{locale}/account/orders` (signed in), component `AccountOrdersView` in `apps/storefront/src/components/account-orders.tsx`.
- Problem: the link to the account overview is the last child of the page (`account-orders.tsx:184-186`):
  `<Link href={localizedHref(locale, "/account")} className={\`self-start ${focusRing}\`}>{t("nav.account.account")}</Link>`.
  It has no underline, so it renders as plain body text ("Мій акаунт" / "My account") below the content; with no orders it sits under the
  empty state like a stray line (seen at 1280 and 375 px, light and dark, on a test customer).
- Design evidence: the two other account pages render the same link (same destination, same role) one way:
  - `apps/storefront/src/components/profile-forms.tsx:271-279` (Profile)
  - `apps/storefront/src/components/account-data.tsx:146-153` (Privacy and data)
  Both: a `<div className="flex flex-col gap-2">` holding the `h1` and, right after it, `<Link href={localizedHref(locale, "/account")}
  className="self-start underline underline-offset-4">{t("account.profile.back")}</Link>` ("Назад до акаунта" / "Back to my account").
- Owner: `apps/storefront/src/components/account-orders.tsx` (`AccountOrdersView`).
- Scope and affected surfaces: the orders list page in every state (loading, error, out of range, empty, list). The order detail page in
  the same file (`account-orders.tsx:315-317`, "Назад до моїх замовлень") is a different link (to the list) and is not changed.
- Uncertainty: none for the change. The exemplars do not add `focusRing`; this link has it and keeps it (see Preserve).

## Design decision

Render the orders page's account link exactly like the Profile and Privacy and data pages: under the page title, underlined, with the same
label. The account area then shows its "back to my account" link in one place, one style and one wording.

## Reuse

- Message `account.profile.back` (`uk`: "Назад до акаунта", `en`: "Back to my account"); no new key.
- Classes `self-start underline underline-offset-4`; layout `flex flex-col gap-2` around the `h1` and the link.
- Exemplar: `apps/storefront/src/components/account-data.tsx:146-153`.

No new component or token.

## Changes

1. `apps/storefront/src/components/account-orders.tsx`, `AccountOrdersView`
   - Change: replace the `h1` at line 111 with `<div className="flex flex-col gap-2">` containing that `h1` and, after it,
     `<Link href={localizedHref(locale, "/account")} className={\`self-start underline underline-offset-4 ${focusRing}\`}>{t("account.profile.back")}</Link>`.
     Delete the link at lines 184-186 (the last child of the outer `div`).
   - Preserve: the outer `flex flex-col gap-6`, the `h1` text and `textStyles.pageTitle`, every state block (skeletons, `Alert`, out of range,
     `EmptyState`, list and `Pagination`), the order detail view and its back link, and `focusRing` on the moved link (it already has a
     visible focus; removing it is not part of this change).
   - Verify: `/uk/account/orders` shows "Назад до акаунта" underlined directly under "Мої замовлення" and no "Мій акаунт" line at the end;
     `/en/account/orders` shows "Back to my account"; the link goes to `/{locale}/account`; Tab reaches it with the focus ring.
2. `apps/storefront/src/messages/{uk,en}/shell.json`
   - Change: none. Check whether `nav.account.account` is still used elsewhere (the header account menu and the breadcrumbs use it), so it
     stays.

## Scope

- Inherit: the orders list page in every state, both locales, both themes.
- Verify: the account breadcrumbs ("Головна / Мій акаунт / Мої замовлення") and the side navigation are unchanged; a list with orders and
  pagination still reads well with the link moved to the top; the order detail page is unchanged.
- Exclude: the order detail page's back link (`account-orders.tsx:315-317`; also unstyled and at the bottom, a separate decision); adding
  `focusRing` to the Profile and Privacy and data links; any other account page.

## Validation

- Product: a signed-in customer opens "Мої замовлення" with and without orders and returns to the overview through the link.
- Interface: 1280 and 375 px, light and dark; empty list, a list with orders, the loading state; keyboard focus on the link.
- System: the three account pages render the same element with the same classes and message (`grep -n "account.profile.back"
  apps/storefront/src/components/*.tsx` lists the three files); no new key, component or token.
- Repository:
  - `pnpm --filter @fluxkit/storefront test` → passes.
  - `pnpm lint`, `pnpm typecheck`, `pnpm format:check` → pass.
  - `pnpm test:e2e` → passes (the e2e tests look up "My account" inside the breadcrumbs only, `e2e/tests/design-a.e2e.ts:288-296`).
  - The `visual` CI job may report a changed account orders screenshot if it captures that page; record it in `.visual/exceptions.json` only
    if it does.

## Stop conditions

- Stop if `AccountOrdersView` no longer matches the lines quoted above, or if the account pages have meanwhile moved to a shared header
  component: use that component instead.
- Stop if a test asserts the old bottom link: report it rather than weakening the test.

## Design documentation

- After acceptance and validation: one line in `CHANGELOG.md` (user-visible: the account orders page's link back to the account moved under
  the title and reads "Back to my account"). No contract change.
