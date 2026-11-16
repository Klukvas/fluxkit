# Demo notice on the storefront (2026-11-16)

Status: approved by the owner 2026-11-16 ("Да, план и делай"), including the red-zone item (a new storefront config variable).

## Goal

The test server (`fluxkitcore.com`) runs the template as a public demo. A visitor must see at once that it is a demo shop (made-up products,
prices and orders, no money taken) and find a link to order a similar shop from FluxLab (`https://flux-lab.dev`). A client shop built from
the template must never show any of it.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Switch | New storefront variable `STOREFRONT_DEMO_NOTICE`, exactly `true` or `false`, unset or blank = `false`, read per request like `STOREFRONT_FORWARD_CLIENT_ADDRESS` | Master ships to every client; the notice must be off unless a deployment asks for it. Runtime, not build time: the same image runs with or without it |
| Feature package? | No | Storefront-only UI, no API, routes or tables; a feature package (ADR 0049) would be ceremony. The variable is the single switch (AGENTS.md 2.1 is about optional shop features, this is a deployment mode) |
| What the visitor sees | (1) a thin strip above the header on every page, not dismissible; (2) a modal on the first visit, once per browser; (3) a note on the checkout page | The modal informs, the strip keeps informing after it is closed, the checkout note is where a visitor could enter real data |
| "Seen" memory | `localStorage` key `fluxkit_demo_notice_seen`; no cookie | Functional, never sent to the server, needs no consent banner. The key is written just before the modal opens (QA review: a write failing only at close would reopen it on every page); when storage cannot be read or written the modal is not shown (the strip still informs) |
| Link | `https://flux-lab.dev/<locale>` (`uk`, `en`; both answer 200; `fluxlab.dev` does not resolve) with `utm_source=fluxkit-demo&utm_medium=demo-notice`, new tab, `rel="noopener noreferrer"` | The owner's site; UTM lets the owner see visits from the demo, nothing is tracked on our side |
| Where the URL lives | `apps/storefront/src/config/demo-notice.ts` | Not shop branding and not a user-facing string; one place to change |
| `noindex` for the demo | Out of scope | The owner may want the demo found; separate decision |

## Copy (messages `demo.*`, `uk` default, `en`)

- Strip: uk «Це демо-магазин: товари, ціни й замовлення не справжні.» + link «Хочу такий магазин»; en "This is a demo shop: the products, prices and orders are not real." + "I want a shop like this".
- Modal title: «Це демо-магазин» / "This is a demo shop".
- Modal body: uk «Це демонстрація шаблону інтернет-магазину. Товари, ціни й замовлення тут вигадані: нічого не буде доставлено, гроші не списуються. Пробуйте все: кошик, оформлення, особистий кабінет. Вводьте вигадані дані, не справжні.» / en "This is a demo of an online shop template. The products, prices and orders are made up: nothing is delivered and no money is taken. Try everything: the cart, checkout, your account. Use made-up details, not real ones."
- Modal CTA line: uk «Потрібен такий магазин для вашого бізнесу? Його робить FluxLab.» / en "Want a shop like this for your business? FluxLab builds it."
- Modal buttons: primary «Переглянути демо» / "Explore the demo" (closes); link «Замовити такий магазин» / "Order a shop like this" (FluxLab, closes and remembers too).
- Checkout note: uk «Демо-магазин: замовлення не буде виконано, гроші не списуються. Вводьте вигадані дані.» / en "Demo shop: the order will not be fulfilled and no money is taken. Use made-up details."

## Changes

- `packages/config/src/storefront-env.ts`: `STOREFRONT_DEMO_NOTICE` (same strict `true`/`false` rule) -> `StorefrontEnv.demoNotice`; spec cases.
- `apps/storefront/src/lib/demo-notice.server.ts`: `demoNoticeEnabled()` (`connection()` then `loadStorefrontEnv`).
- `apps/storefront/src/config/demo-notice.ts`: the FluxLab URL per locale.
- `apps/storefront/src/components/demo-notice.tsx` (strip, server-renderable) and `demo-notice-dialog.tsx` (client, ui `Dialog`); rendered by `SiteShell` only when the layout passes `demoNotice`; the skip link stays the first Tab stop.
- Checkout page: the note (ui `Alert`, `info`) when the flag is on.
- Messages `demo.*` in `uk` and `en`; tokens only.
- Tests: env parsing; component specs (strip and link per locale; modal opens without the key and writes it before opening, stays closed with it, storage read or write failure keeps it closed; nothing rendered when off; checkout note only when on). Existing e2e and visual suites run with the flag off, so they are unchanged; the e2e storefront servers pin `STOREFRONT_DEMO_NOTICE=false` so a developer's `.env` cannot leak it in.
- Deployment: `infra/docker-compose.prod.yml` passes `STOREFRONT_DEMO_NOTICE` (default `false`) to `storefront`; `infra/production.env.example` documents it commented out.
- Docs: `.env.example`, `docs/contracts/config.md` (additive optional variable, minor), `docs/deployment.md`, `docs/files/storefront.md`, `CHANGELOG.md`, `docs/HANDOFF.md`.

## Removing it in a client fork

Leave the variable unset: nothing renders. To delete the code: the two components, `config/demo-notice.ts`, `lib/demo-notice.server.ts`,
the `demo.*` messages and the variable in config and docs.

## Verification

`pnpm lint`, `format:check`, `typecheck`, `check:boundaries`, `check:env`, storefront and config unit tests; the storefront run locally
with the flag on and off (modal once, strip on every page, checkout note, links per locale, keyboard and Escape). Independent review by a
different model.

## After merge (owner's go)

Set `STOREFRONT_DEMO_NOTICE=true` in `/etc/fluxkit/production.env` on the test server; then recreate the storefront container (`up -d --no-deps --force-recreate --wait storefront`) or let the next deploy do it; a plain restart keeps the old environment.
