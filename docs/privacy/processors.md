# Processors and transfers

What leaves the shop's own database and servers when a service is enabled, where in the code it happens, and the open legal questions. It describes what exists; contracts, roles and transfer mechanisms are not known to the template. Nothing here is legal advice. TODO(fluxkit): legal review of this whole file (plan tasks O2, O7).

Every configured primary/fallback mail provider may receive transactional mail; a fallback is a processor even before it is selected for a particular message. A service is contacted only when it is enabled by configuration (`docs/contracts/config.md`). Disabling new work preserves operations on already bound managed payments/shipments until revocation. The personal-data export lists which of these the shop uses (`docs/contracts/personal-data-export.md`).

## Services the code integrates

| Service | Enabled by | What data goes there | Where in the code | Contract and DPA | Role | Data location |
|---|---|---|---|---|---|---|
| Nova Post (carrier): `https://api.novapost.com/v.1.0` (production), `https://api-stage.novapost.com/v.1.0` (sandbox) | Env selection `SHIPPING_PROVIDERS_ENABLED=nova_post` with `NOVA_POST_API_KEY`, or activated admin credentials; retained bound shipments continue after disable | Recipient first and last name and phone, the pickup point, the order number as client reference, tracking numbers for status calls, the sender profile (name, phone, email, company) from the shipping provider settings; the plugin sends no recipient email | `packages/providers/nova-post/src/nova-post-provider.ts`, `packages/providers/nova-post/src/settings.ts`, `packages/providers/nova-post/src/config.ts` | TODO(fluxkit): legal review | TODO(fluxkit): legal review (processor or independent controller) | UNKNOWN |
| Resend (mail): `https://api.resend.com` | `EMAIL_PROVIDER=resend` or `EMAIL_FALLBACK_PROVIDERS` includes `resend`; `RESEND_API_KEY` | Recipient address, sender and reply-to addresses, rendered subject and bodies (order contents, tracking number, guest order link, reset and verification links). Open and click tracking stay off | `packages/providers/resend/src/resend-provider.ts`, `packages/providers/resend/src/request.ts`, `packages/providers/resend/src/config.ts` | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN |
| Brevo (mail): `https://api.brevo.com/v3/smtp/email` | `EMAIL_PROVIDER=brevo` or `EMAIL_FALLBACK_PROVIDERS` includes `brevo`; `BREVO_API_KEY` | One recipient, sender/reply-to, subject/HTML/text (order data and bearer links), category and message UUID | `packages/providers/brevo/src/` | TODO(fluxkit): legal review of terms/entity/DPA, subprocessor transfers and retention | TODO(fluxkit): legal review | Documented EU database hosting; full processing locations/transfers UNKNOWN |
| Monobank acquiring: `https://api.monobank.ua` | Env selection names `monobank`, or the admin activates its managed credential | Amount, currency, payment attempt id, "Order <number>" as description, basket lines (titles, quantities, prices, SKUs, shipping line), return and webhook URLs. No shopper name, email or address. Card data is entered on the provider's page. Comes back: status, card system and masked card number | `packages/providers/monobank/src/monobank-provider.ts`, `packages/providers/monobank/src/invoice.ts`, `packages/providers/monobank/src/config.ts`; the webhook route `POST /webhooks/payments/{provider}` is in `apps/api/src/payments/webhook` | TODO(fluxkit): legal review | TODO(fluxkit): legal review (the bank is possibly an independent controller of card data) | UNKNOWN |
| LiqPay (PrivatBank): `https://www.liqpay.ua` | Env selection names `liqpay`, or the admin activates its managed credential | Amount (major units), currency UAH, payment attempt id as `order_id`, description, return and server (webhook) URLs. No shopper name, email or address in the signed checkout payload. Card data is entered on LiqPay's page. Comes back: status, optional card mask / system in the callback `data` JSON | `packages/providers/liqpay/src/liqpay-provider.ts`, `packages/providers/liqpay/src/payload.ts`, `packages/providers/liqpay/src/config.ts`; webhook `POST /webhooks/payments/liqpay` (urlencoded `data`+`signature`, ADR 0059) | TODO(fluxkit): legal review | TODO(fluxkit): legal review (the bank is possibly an independent controller of card data) | UNKNOWN |
| Meilisearch (self-hosted) | `SEARCH_ENABLED=true`, `MEILI_URL` | Catalog data only: published sellable products, public attributes, shop-currency prices (`docs/api/search.md`). No personal data | `apps/api/src/search` | Not applicable while it is self-hosted and holds no personal data; TODO(fluxkit): legal review | None while self-hosted | The operator's host |
| Redis (self-hosted) | `REDIS_URL` | Nothing: the application only parses the setting today (`packages/config/src/env.ts`); the BullMQ spike is a test (`apps/api/src/spikes/queue.spec.ts`) | none beyond configuration | Not applicable while self-hosted; TODO(fluxkit): legal review | None while self-hosted | The operator's host |

## Operator placeholders

The template names no host, CDN or backup provider. Fill these in.

| Service | What data goes there | Contract and DPA | Role | Data location |
|---|---|---|---|---|
| Hosting (servers, database, volumes) | Everything: database, media files, container logs | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN (no host chosen) |
| CDN or edge proxy outside the shop's servers | Client IP address, URL with query string, user agent; the traffic passing through | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN |
| Backup storage | Dumps of the database and the media volume (`docs/deployment.md`, Backups); erased data stays in a backup until it ages out | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN |
| The shop's own mailbox and support tools | Whatever customers write | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN |

## Transfers: questions for the lawyer (no answers here)

- Are Nova Post, Monobank and every configured mail provider processors, joint controllers or independent controllers for the data they receive?
- Is data sent from the EU to Ukraine, from Ukraine to the EU, or to a third country (for example a mail provider in the US), and which transfer mechanism applies to each?
- Where does each provider store and process the data, and can the shop choose the region?
- Which law applies to the shop and to each provider (Ukrainian data protection law, GDPR, both), and is an EU representative needed?
- Which processor contracts exist, which must be signed, and what do they say about sub-processors and deletion on request?
- How long does each provider keep the data after delivery, and how does the shop ask it to delete a person's data?
- Does the hosting location of the database and the backups decide any of the above?

## Related

`docs/privacy/README.md` section 6 (the operator's short list), `docs/privacy/ropa-template.md`, `docs/dependencies.md` (service records).

- Email suppression feedback (ADR 0056 step 1b): each configured Resend/Brevo processor returns normalized recipient/event/reason/time facts through its authenticated webhook; the app persists only the D16 suppression/receipt fields in the inventory. No request forwards these facts to a second provider. Brevo bearer auth is not a body signature. Remote retention/erasure, terms/DPA/transfers, historical-block reconciliation and live subscription verification remain owner tasks; see each plugin README and `docs/deployment.md`.

- Ordered email fallback (ADR 0056 step 2) does not route around suppression or ambiguity: all selected services require the local guard, migration 0017 and their authenticated webhook setup before fallback startup. Operator reconciliation/live checks remain necessary. An accepting provider is recorded per sent row; configured processor enumeration is not proof a particular provider received a particular subject's mail. Never expose account identities, API keys or webhook secrets in exports/notices.
- The usage meter is retained local accepted history by provider code across all accounts, with UTC daily/monthly periods and a permanent lower-bound warning. It does not extend outbox retention or prevent erasure; cleanup/erasure can reduce counts. Account changes are not tracked and do not reset history. No exact account balance or automatic quota routing is inferred. Shared cooldown/probe/route columns hold operational codes/times/random probe tokens, not credentials or account identity; suppression/receipts remain personal data under D16.
- TODO(fluxkit): not live-verified — both providers' send/quota and feedback semantics, remote queue timing and retention/deletion. Brevo Free branding removal needs a paid plan. Owner/legal review every selected processor, including fallbacks, and complete the shop's privacy notice before production; EU database hosting alone makes no transfer guarantee.

Managed Monobank saves additionally read merchant details using the submitted token. Only merchantId is retained as a permanent AES-GCM encrypted anti-substitution baseline (D26), with separate AAD; merchantName/edrpou/provider text are not retained. Disable/revoke do not erase it. Credential-version links and merchant material stay excluded from shopper exports. Retained version clients serve historical payments/refunds even while new admissions are disabled.
