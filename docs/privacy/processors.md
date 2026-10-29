# Processors and transfers

What leaves the shop's own database and servers when a service is enabled, where in the code it happens, and the open legal questions. It describes what exists; contracts, roles and transfer mechanisms are not known to the template. Nothing here is legal advice. TODO(fluxkit): legal review of this whole file (plan tasks O2, O7).

A service is contacted only when it is enabled by configuration (`docs/contracts/config.md`). With it off nothing is sent. The personal-data export lists which of these the shop uses (`docs/contracts/personal-data-export.md`).

## Services the code integrates

| Service | Enabled by | What data goes there | Where in the code | Contract and DPA | Role | Data location |
|---|---|---|---|---|---|---|
| Nova Post (carrier): `https://api.novapost.com/v.1.0` (production), `https://api-stage.novapost.com/v.1.0` (sandbox) | `SHIPPING_PROVIDERS_ENABLED=nova_post`, `NOVA_POST_API_KEY` | Recipient first and last name and phone, the pickup point, the order number as client reference, tracking numbers for status calls, the sender profile (name, phone, email, company) from the shipping provider settings; the plugin sends no recipient email | `packages/providers/nova-post/src/nova-post-provider.ts`, `packages/providers/nova-post/src/settings.ts`, `packages/providers/nova-post/src/config.ts` | TODO(fluxkit): legal review | TODO(fluxkit): legal review (processor or independent controller) | UNKNOWN |
| Resend (mail): `https://api.resend.com` | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` | Recipient address, sender and reply-to addresses, rendered subject and bodies (order contents, tracking number, guest order link, reset and verification links). Open and click tracking stay off | `packages/providers/resend/src/resend-provider.ts`, `packages/providers/resend/src/request.ts`, `packages/providers/resend/src/config.ts` | TODO(fluxkit): legal review | TODO(fluxkit): legal review | UNKNOWN |
| Monobank acquiring: `https://api.monobank.ua` | `PAYMENT_PROVIDERS_ENABLED` names `monobank` | Amount, currency, payment attempt id, "Order <number>" as description, basket lines (titles, quantities, prices, SKUs, shipping line), return and webhook URLs. No shopper name, email or address. Card data is entered on the provider's page. Comes back: status, card system and masked card number | `packages/providers/monobank/src/monobank-provider.ts`, `packages/providers/monobank/src/invoice.ts`, `packages/providers/monobank/src/config.ts`; the webhook route `POST /webhooks/payments/{provider}` is in `apps/api/src/payments/webhook` | TODO(fluxkit): legal review | TODO(fluxkit): legal review (the bank is possibly an independent controller of card data) | UNKNOWN |
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

- Are Nova Post, Monobank and the mail provider processors, joint controllers or independent controllers for the data they receive?
- Is data sent from the EU to Ukraine, from Ukraine to the EU, or to a third country (for example a mail provider in the US), and which transfer mechanism applies to each?
- Where does each provider store and process the data, and can the shop choose the region?
- Which law applies to the shop and to each provider (Ukrainian data protection law, GDPR, both), and is an EU representative needed?
- Which processor contracts exist, which must be signed, and what do they say about sub-processors and deletion on request?
- How long does each provider keep the data after delivery, and how does the shop ask it to delete a person's data?
- Does the hosting location of the database and the backups decide any of the above?

## Related

`docs/privacy/README.md` section 6 (the operator's short list), `docs/privacy/ropa-template.md`, `docs/dependencies.md` (service records).
