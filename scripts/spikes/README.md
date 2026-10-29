# Spikes

One-off verification scripts that a human runs by hand. They are not part of any package, build or CI job; `pnpm lint` and `pnpm format:check` cover them like the other `scripts/`.

## `nova-post-verify.mjs` (shipping plan step 7a, ADR 0030)

Checks the new Nova Post REST API (`https://api.novapost.com/v.1.0`, JWT) against the documented facts of `docs/plans/2026-10-24-shipping.md` section 8 (hypotheses `H01` to `H35`, each citing its documentation page) before the plugin (plan step 7b) is coded. Plain Node 22 ESM, built-in `fetch`, no dependencies.

### Stages and environments

`--env sandbox` (default, `https://api-stage.novapost.com/v.1.0`) or `--env production` (`https://api.novapost.com/v.1.0`). Base URLs are constants in the script.

| Stage | Needs | What it calls | Creates on the account |
|---|---|---|---|
| `keyless` | nothing | Error shapes of `GET /clients/authorization` (no, empty and an invented key), `401` of `/divisions` and `/settlements` without, with a junk raw and a junk `Bearer` token, an unauthenticated invalid-JSON `POST /shipments`, an unknown route, the key-less `GET /dictionary/divisions` redirect, `POST /test-api-keys` with an empty body (validation only), the alternative sandbox host, a burst of 5 | nothing (no key is sent) |
| `readonly` (default) | `NOVA_POST_API_KEY` | `keyless` first, then: the JWT (lifetime from its claims, raw vs `Bearer` header, a second token), `/settlements` (search, languages, page 2, limits 100/101/500, country total), the settlement for the division calls (`--settlement-id`, else up to 5 candidates of a `--city-query` search with `Accept-language: uk`, probed with `GET /divisions?limit=1`: the first exact name match that has divisions, else the one with the most; recorded as `settlementChoice`), `/divisions` of that settlement (pages, fields, categories, languages, category filters, limits, undocumented by-id filters, unknown settlement, country total), `POST /shipments/calculations` (division to division, one error sample), `GET /shipments` (shapes, order, limits, an undocumented `clientOrder` filter), tracking, history and the label request (`type=marking`) of an invented number, 100 and 101 invented tracking numbers, `GET /clients` and `GET /tracking-push/subscribers` (shapes only), a junk token, a burst of 10 | nothing (`POST /shipments/calculations` only prices) |
| `write` | the key, `--confirm`, sender and recipient inputs; on production also `--allow-production-write` | `keyless` first, then the printed plan: the JWT, `POST /shipments` (A), the same body again (B, idempotency), find back by number, by id and by paging for `clientOrder`, tracking and history, the label PDF of A (`GET /shipments/print?numbers[]=<number>&type=marking`; on a refusal once more with `&format=pdf`; each attempt's status and error keys and texts are recorded), `DELETE` of B by number (expected refusal), of A by id after its label, of A again (repeat), of B by id, of a random uuid, a check that A and B are gone, and a `finally` that deletes again whatever is not confirmed gone | one or two shipments, deleted in the same run |

Without `--confirm` the `write` stage prints its plan and exits 2 before any call; with `--env production` it also exits 2 unless `--allow-production-write` is given. Each shipment carries `clientOrder` = `FLUXKIT-SPIKE-<UTC timestamp>-<random>` (33 characters), `note` "Fluxkit API check, delete", one parcel of the flags' size and weight, payer `Recipient` unless overridden, division to division in Ukraine. It is never handed in; check the cabinet after the run anyway (whether creating or deleting a production shipment costs anything is not documented).

### How a human runs it

The key and personal data come from the environment only; never put them on the command line (shell history) or in a file in the repository. Prefer a sandbox key (`POST /test-api-keys` on the sandbox with a phone registered at `my.novapost.com`; the docs say UA key generation is not supported yet, so ask the Nova Post manager if it fails). Delete or expire test keys after the spike.

```bash
# 0. Self-test (local stub server, no network): redaction and stage gating.
node scripts/spikes/nova-post-verify.mjs --self-test

# 1. Key-less probes (safe anywhere), sandbox and production.
node scripts/spikes/nova-post-verify.mjs --stage keyless --out nova-post-findings-keyless.json
node scripts/spikes/nova-post-verify.mjs --stage keyless --env production --out nova-post-findings-keyless-prod.json

# 2. Read-only, with the key typed at a hidden prompt (not in history). Use --env production with a production key.
read -rs NOVA_POST_API_KEY && export NOVA_POST_API_KEY
node scripts/spikes/nova-post-verify.mjs --stage readonly --env sandbox --out nova-post-findings-readonly.json
#    Optional: --city-query <settlement name> (default Київ) or --settlement-id <int> (NP_SPIKE_SETTLEMENT_ID) to pick
#    the settlement whose divisions are examined; --sender-division-id / --recipient-division-id price that route.
#    Rerun after the production run of 2026-10-25 (division facts H12 to H16, H18):
node scripts/spikes/nova-post-verify.mjs --stage readonly --env production --out nova-post-findings-readonly.json

# 3. Write: first without --confirm to read the plan (exits 2, nothing sent), then with it.
read -r  NP_SPIKE_SENDER_NAME && export NP_SPIKE_SENDER_NAME
read -rs NP_SPIKE_SENDER_PHONE && export NP_SPIKE_SENDER_PHONE           # 380XXXXXXXXX
read -r  NP_SPIKE_RECIPIENT_NAME && export NP_SPIKE_RECIPIENT_NAME       # a test recipient the owner controls
read -rs NP_SPIKE_RECIPIENT_PHONE && export NP_SPIKE_RECIPIENT_PHONE
#    Optional: NP_SPIKE_SENDER_EMAIL, NP_SPIKE_SENDER_COMPANY_TIN + NP_SPIKE_SENDER_COMPANY_NAME (legal entity),
#    NP_SPIKE_PAYER_CONTRACT_NUMBER (non-cash payment), NP_SPIKE_RECIPIENT_EMAIL.
node scripts/spikes/nova-post-verify.mjs --stage write --sender-division-id <int> --recipient-division-id <int>
node scripts/spikes/nova-post-verify.mjs --stage write --confirm --sender-division-id <int> --recipient-division-id <int> --out nova-post-findings-write.json
#    Production only after the owner's explicit go: add --env production --allow-production-write.
#    Rerun after the production run of 2026-10-25 (label H27, H30; one shipment, deleted at the end):
node scripts/spikes/nova-post-verify.mjs --stage write --env production --allow-production-write --confirm \
  --skip-repeat-create --sender-division-id <int> --recipient-division-id <int> --out nova-post-findings-write.json

unset NOVA_POST_API_KEY NP_SPIKE_SENDER_NAME NP_SPIKE_SENDER_PHONE NP_SPIKE_SENDER_EMAIL NP_SPIKE_SENDER_COMPANY_TIN \
  NP_SPIKE_SENDER_COMPANY_NAME NP_SPIKE_PAYER_CONTRACT_NUMBER NP_SPIKE_RECIPIENT_NAME NP_SPIKE_RECIPIENT_PHONE NP_SPIKE_RECIPIENT_EMAIL
```

- The division ids are the integer `id` of `GET /divisions` (never `externalId`); the readonly findings list the fields, and the cabinet or `GET /divisions?settlementIds[]=` gives the ids. Both flags also read `NP_SPIKE_SENDER_DIVISION_ID` and `NP_SPIKE_RECIPIENT_DIVISION_ID`. Other flags: `--payer-type Sender|Recipient`, `--weight-g`, `--length-mm`, `--width-mm`, `--height-mm`, `--declared-value` (UAH), `--skip-repeat-create`.
- Behind an HTTPS proxy, Node's `fetch` may need `NODE_USE_ENV_PROXY=1` (Node 22.21 or later); otherwise calls fail with a transport error. (In the cloud sandbox where this tool was written, Node 22.22 reached the API without it.)
- Exit codes: `0` done; `1` a stage call failed (findings are still written, the summary says which); `2` usage error or refusal, nothing sent; `3` the write stage could not confirm that every spike shipment is deleted: the last line names their numbers, delete them by hand in the cabinet.

### Reading the findings

- The terminal ends with `H01` to `H35`, each `CONFIRMED`, `DIFFERENT` or `NOT TESTED` with the observed fact and the documentation page it checks. `DIFFERENT` items must be written into the plan (section 8) before step 7b.
- The findings JSON (`--out`, default `./nova-post-findings.json`, mode 600, git-ignored by `nova-post-findings*.json`) holds `hypotheses`, `facts` per stage and `calls`: per call the label, method, path template, which token form was sent, HTTP status, content type, latency, response bytes, header names, rate-limit-like headers, top-level keys, page meta, item count and item shape, error keys and scrubbed error texts.
- Division facts (H12 to H14, H16) are `NOT TESTED` when the chosen settlement lists no division (the first `Київ` hit of the 2026-10-25 run was such a settlement); rerun with `--settlement-id`.
- A refused label (H27 `DIFFERENT`) lists every attempt with its HTTP status, error keys and scrubbed error texts; H30 is then `NOT TESTED`. Tracking (H25) reads the status from the documented `currentStatus[0]` or from `items[0]` (the shape production answered) and records which (`statusCodeFoundAt`) and the item's field names.
- Shapes are field names and types only: strings become a class (`uuid`, `digits(14)`, `AAAA+digits(10)`, `datetime(ISO, Z)`, `text(cyrillic)`, ...), never their value. Explicit values are kept only for public dictionaries (division categories, statuses, sources, status codes) and counts.
- Never recorded: the key (it travels in the query of the authorization call, so no URL is recorded; every output is also scrubbed for it), the JWTs (scrubbed as soon as they are issued, and any JWT-like text), phones, names, emails, company TIN and name, the contract number, request bodies. Carrier texts are cut to 200 characters with long digit runs replaced.
- Still review the file before sharing it: it describes the shape of the owner's account (counts, field names). Copy the facts into the plan, not the file.

### Self-test

`--self-test` starts a local stub of the API on `127.0.0.1` (it echoes the key, and its rows carry phones and names on purpose) and runs: refusal without a key, refusal of `write` without `--confirm`, on production without `--allow-production-write`, or with missing inputs (no request reaches the stub), usage errors, `keyless` (the real key is never sent), `readonly` with a key (creates and deletes nothing; the stub's first settlement has no divisions, so the choice of the exact name match is asserted, and the label request must pass the stub's `type` validation) and with a rejected key (the echoed key is scrubbed), the settlement choice without an exact match (the most divisions), `--settlement-id` of a settlement without divisions (H12 to H14 and H16 `NOT TESTED`), a non-numeric `--settlement-id` (usage error), `write` end to end on the sandbox and, with the extra flag, on the production target, failing deletes retried in `finally`, a thrown error mid-stage (cleanup still deletes), a cleanup that cannot delete (exit 3 with the leftovers named), a refused label (both attempts recorded with error keys, a phone-like digit run in the error text scrubbed, H27 `DIFFERENT`, H30 `NOT TESTED`, cleanup still complete), a tracking answer shaped `{items: [...]}`, a tracking route that answers `500`. After each run it asserts that no key, JWT or personal value appears in the terminal output or the findings file.

## `resend-verify.mjs` (email plan step 6, check S1, ADR 0031 decision 17)

Checks the documented Resend facts that `packages/providers/resend` codes against (plan `docs/plans/2026-10-26-email.md`, section 2, R1 to R9) with ONE real mail to the owner's own address. Plain Node 22 ESM, built-in `fetch`, no dependencies. The endpoint `https://api.resend.com/emails` is a constant; redirects are refused. **Not run against Resend yet** (built 2026-10-26 without a key; only its self-test has run).

| Stage | Needs | What it sends | Mail delivered |
|---|---|---|---|
| `keyless` | nothing | `POST /emails` without a key, with an invented `re_` key, and with an invented key and an empty `User-Agent` (R8, R9, R6) | none (no valid key) |
| `send` (default) | `RESEND_API_KEY`, `RESEND_SPIKE_FROM`, `RESEND_SPIKE_TO`, `--confirm` | `keyless` first, then: the key with an empty `User-Agent` and an empty recipient list (R6); ONE test mail shaped exactly like the plugin's request (`"Name" <from>`, `to` array, `subject`, `html`, `text`, `reply_to`, `tags`, `User-Agent`, a random `Idempotency-Key`; R1, R2, R3, R5, R7); the same key and body again (R4: same id); the same key with another subject (R4: `409 invalid_idempotent_request`); a 257-character key with an empty recipient list (R4: `400 invalid_idempotency_key`) | ONE, if R4 holds (the replay and the changed subject must not deliver; check the inbox) |

Without `--confirm` the `send` stage prints its plan and exits 2 before any call; a missing input or a malformed address also exits 2 with nothing sent.

### How the owner runs it (S1, with the owner's go)

The packaged steps (domain, sending-only key, the header checks) are in `packages/providers/resend/README.md`, "Plan S1". The commands:

```bash
# 0. Self-test (local stub on 127.0.0.1, no network): gating and redaction.
node scripts/spikes/resend-verify.mjs --self-test

# 1. Inputs from a hidden prompt (never as flags, never in a file in the repository).
read -rs RESEND_API_KEY && export RESEND_API_KEY              # a sending-only key
read -r RESEND_SPIKE_FROM && export RESEND_SPIKE_FROM          # "Shop Name <noreply@mail.your-domain>" on the verified domain
read -r RESEND_SPIKE_TO && export RESEND_SPIKE_TO              # the owner's own address (testing mode allows only that, R8)
read -r RESEND_SPIKE_REPLY_TO && export RESEND_SPIKE_REPLY_TO  # optional; default: the sender's address

# 2. The plan without sending (exits 2), then the send.
node scripts/spikes/resend-verify.mjs
node scripts/spikes/resend-verify.mjs --confirm --out resend-findings.json

unset RESEND_API_KEY RESEND_SPIKE_FROM RESEND_SPIKE_TO RESEND_SPIKE_REPLY_TO
```

- `--stage keyless` alone sends no valid key and can run without inputs.
- Exit codes: `0` done; `1` a call failed in transport or a stage threw (findings still written); `2` usage error or refusal, nothing sent.
- Behind an HTTPS proxy, Node's `fetch` may need `NODE_USE_ENV_PROXY=1` (Node 22.21 or later).

### Reading the findings

- The terminal ends with `R1` to `R9` (R4 and R8 split into `a`, `b`, `c`), each `CONFIRMED`, `DIFFERENT`, `NOT TESTED`, `RECORDED` (R7: the rate-limit headers seen) or `MANUAL` (R3: open the received mail's headers; `Reply-To` must be `RESEND_SPIKE_REPLY_TO`, else Resend ignored the `reply_to` member and the plugin must change). `DIFFERENT` items go into the plan's step 6 row and change the plugin before production. R8b records whether an invented key is `400` or `401` (the plugin reads `400 validation_error` as `rejected`, `401` as `misconfigured`).
- The findings JSON (`--out`, default `./resend-findings.json`, mode 600, git-ignored by `resend-findings*.json`) holds `hypotheses`, `facts` per stage and `calls`: per call the label, which key was sent (`none`, `invented`, `key`), the `User-Agent` form, the idempotency key's length, a short hash of the body, the HTTP status, content type, latency, header names, rate-limit headers (numeric values only), the answer's keys, the error `name` when it is a code, the message's length and whether it echoes an address, and the id's shape (`uuid`).
- Never recorded: the key (scrubbed from every output, a fragment too), the sender, recipient and reply-to addresses and names, any address-like or `re_`-like text, request bodies, Resend's message texts, the mail's id value.

### Self-test

`--self-test` starts a local stub of Resend on `127.0.0.1` (it echoes the key and the recipient in its texts on purpose) and runs: refusal without a key, without a recipient, without `--confirm` (plan printed, no request), with a malformed sender, an unknown flag (no request in each), `keyless` (three requests, the key never sent, R8a and R9 confirmed), and `send` end to end (exactly one mail accepted by the stub, the replay and the changed body answered as R4 says, the body's members and the `User-Agent` pinned, R1 to R9 as expected, R3 `MANUAL`). After each run it asserts that no key, key fragment, address or name appears in the terminal output or the findings file.

## `monobank-verify.mjs` (payments plan check S1, ADR 0032 decision 15)

Checks the documented Monobank acquiring facts that `packages/providers/monobank` codes against (plan `docs/plans/2026-10-26-payments-monobank.md`, section "Monobank acquiring facts", M1 to M25) with the owner's TEST token. Plain Node 22 ESM, built-in `fetch`, no dependencies. The origin `https://api.monobank.ua` is a constant; redirects are refused. **Not run against Monobank yet** (built 2026-10-29 without a token; only its self-test has run).

| Stage | Needs | What it calls | Changes at Monobank |
|---|---|---|---|
| `readonly` (default) | `MONOBANK_TOKEN` | `GET /api/merchant/pubkey` (key type and curve, M12), `GET /api/merchant/details` (member names only, M22), the status of an invented invoice id (`404` shape, M16) and without an id (`400` shape), `pubkey` with an invented token (`403` shape, M1) | none |
| `invoice` | the token, `--confirm` | `readonly` first, then: a 1.00 UAH test invoice shaped like the plugin's (M3, M4, M23) and its status (M6); the same `reference` again (M5); `validity` 10 s (M19); `ccy` 840 (M18); a refund of the unpaid invoice (M13, `CANCEL_NOT_AVAILABLE`); `remove` of every created invoice, its status after and a second `remove` (M14) | up to four unpaid test invoices, all removed in the same run (a `finally` removes them even after a failure) |
| `pay` | the token, `--confirm`; `MONOBANK_SPIKE_WEBHOOK_URL` optional (`https`) | `readonly` first, then ONE 2.00 UAH test invoice (with `webHookUrl` when set); prints its payment page for the owner to pay with a Luhn-valid TEST card; polls the status every 5 s for at most 10 minutes; once paid: refund 0.50 UAH with `extRef` A, the same `extRef` and amount again (M13 dedupe), 0.50 UAH with `extRef` B (several partial refunds), the rest with `extRef` C and an explicit amount (full refund; `reversed`?), the status after each; `remove` of the paid invoice (M14) | one test payment (no real money with a test token, M2), refunded |
| `webhook` | the token, `MONOBANK_SPIKE_WEBHOOK_BODY_FILE`, `MONOBANK_SPIKE_WEBHOOK_SIGN` | `GET /api/merchant/pubkey`, then verifies the saved live webhook body (byte for byte) and its `X-Sign` with that key, and that a changed byte fails (M12 live) | none |

Without `--confirm` the `invoice` and `pay` stages print their plan and exit 2 before any call; a missing token, a non-`https` webhook URL or missing webhook inputs also exit 2 with nothing sent.

### How the owner runs it (S1, with the owner's go)

Prerequisites (`packages/providers/monobank/README.md`, "Plan S1"): a monobank account; a TEST token from https://api.monobank.ua/; for `pay` a public `https` staging URL that reaches a running API's webhook route (or any `https` endpoint that logs raw POST bodies and headers); about 20 minutes.

```bash
# 0. Self-test (local stub on 127.0.0.1, no network): gating and redaction.
node scripts/spikes/monobank-verify.mjs --self-test

# 1. The token from a hidden prompt (never as a flag, never in a file in the repository, never in chat).
read -rs MONOBANK_TOKEN && export MONOBANK_TOKEN

# 2. Read-only, then the plans of the writing stages (each exits 2 without --confirm), then the writing stages.
node scripts/spikes/monobank-verify.mjs --out monobank-findings-readonly.json
node scripts/spikes/monobank-verify.mjs --stage invoice
node scripts/spikes/monobank-verify.mjs --stage invoice --confirm --out monobank-findings-invoice.json
read -r MONOBANK_SPIKE_WEBHOOK_URL && export MONOBANK_SPIKE_WEBHOOK_URL   # https://<staging>/webhooks/payments/monobank
node scripts/spikes/monobank-verify.mjs --stage pay
node scripts/spikes/monobank-verify.mjs --stage pay --confirm --out monobank-findings-pay.json
#    Open the printed page, pay with a Luhn-valid test card (for example 4242 4242 4242 4242, any future date, any CVV).

# 3. From the staging log: save one webhook's raw body byte for byte and its X-Sign header, then verify it live.
export MONOBANK_SPIKE_WEBHOOK_BODY_FILE=/path/outside/the/repository/webhook-body.json
read -r MONOBANK_SPIKE_WEBHOOK_SIGN && export MONOBANK_SPIKE_WEBHOOK_SIGN
node scripts/spikes/monobank-verify.mjs --stage webhook --out monobank-findings-webhook.json

unset MONOBANK_TOKEN MONOBANK_SPIKE_WEBHOOK_URL MONOBANK_SPIKE_WEBHOOK_BODY_FILE MONOBANK_SPIKE_WEBHOOK_SIGN
```

- Exit codes: `0` done; `1` a call failed in transport or a stage threw (findings still written); `2` usage error or refusal, nothing sent.
- Behind an HTTPS proxy, Node's `fetch` may need `NODE_USE_ENV_PROXY=1` (Node 22.21 or later).
- The staging log is where M8 (which statuses are posted, whether `created` is), M9 (retries) and M10 (order) are read: the tool cannot receive webhooks itself.

### Reading the findings

- The terminal ends with the M-numbers (`M13` split into `a` to `d`), each `CONFIRMED`, `DIFFERENT`, `PARTLY CONFIRMED` (M12 without a live webhook), `RECORDED` (a fact to write down: M2, M10, M13b to d, M14, M17 to M19), `MANUAL` (M8: read the staging log) or `NOT TESTED`. `DIFFERENT` and the recorded facts go into the plan and, where they differ from the plugin's assumptions (its README, "Unverified items"), change the plugin before production.
- The findings JSON (`--out`, default `./monobank-findings.json`, mode 600, git-ignored by `monobank-findings*.json`) holds `hypotheses`, `facts` per stage and `calls`: per call the label, method, path, which token was sent (`token`, `invented`, `none`), the HTTP status, content type, latency, header names, rate-like headers (numeric values only), the answer's member names, the documented `errCode` (else `[undocumented]`) and the length of `errText`. Status answers are reduced to member names, the status word, amounts, the `modifiedDate` shape, `cancelList` statuses, amounts and our `extRef`s, and of `paymentInfo` the card system, the payment method and whether a mask is present; create answers to the id's shape and the page ORIGIN.
- Never recorded: the token (scrubbed from every output with every 8-character fragment), `errText`, `failureReason`, `maskedPan`, `rrn`, `approvalCode`, `merchantName`, `merchantId`, `edrpou`, the payment page path (it is printed to the terminal once, for the owner to open). A card mask in any text is replaced by `[card]`.

### Self-test

`--self-test` starts a local stub of Monobank on `127.0.0.1` (its errors echo the token and a card mask on purpose; it "pays" the 2.00 UAH invoice on the second status read) and runs: refusal without a token, `invoice` and `pay` without `--confirm`, `pay` with an `http` webhook URL, an unknown flag (no request in each), `readonly` (five GET requests, the token only in `X-Token`, M1, M16, M22 confirmed), `invoice` (four creates, the body's members pinned, every invoice removed), `pay` (the page printed, `webHookUrl` sent, four refunds with the expected `extRef`s and amounts, `reversed` at the end) and `webhook` (a stub-signed body verifies, a changed byte does not). After each run it asserts that no token, token fragment, card number part, merchant name, `rrn` or `approvalCode` appears in the terminal output or the findings file.

## `nova-poshta-verify.mjs` (deprecated, legacy API 2.0)

**Deprecated 2026-10-25 (ADR 0030).** It checks the legacy Nova Poshta JSON-RPC API (`https://api.novaposhta.ua/v2.0/json/`), which the plugin no longer targets; the owner's key belongs to the new API. Kept for history (its key-less findings are in the shipping plan, section "Spike 7a — key-less findings (legacy API 2.0, superseded)"); do not extend it. Its usage, unchanged:

#### Stages

| Stage | Needs | What it calls | Creates on the account |
|---|---|---|---|
| `keyless` | nothing | Error and envelope shapes with no, empty and an invented key; unknown model; invalid JSON; `GET`; `/xml/`; plain `http`; key-less tracking of invented numbers (1, 100, 101); a burst of 10 sequential calls | nothing (no key is sent) |
| `readonly` (default) | `NOVA_POSHTA_API_KEY` | `keyless` first, then: `Address.getWarehouseTypes`, `Common.getServiceTypes`/`getCargoTypes`/`getTypesOfPayers`/`getPaymentForms`/`getTypesOfCounterparties`, `Address.searchSettlements`, `Address.getCities` (search, language variants, country total), `Address.getWarehouses` (pages 1 and 2, whole city, by `Ref`, by number, by type, language variants, unknown city and ref), `InternetDocument.getDocumentPrice` (every service type, one error sample), `getDocumentDeliveryDate`, `Counterparty.getCounterparties` (Sender), `getCounterpartyContactPersons`, `getCounterpartyAddresses`, `InternetDocument.getDocumentList` (last 7 days) | nothing |
| `write` | the key, `--confirm`, sender and recipient inputs | `keyless` first, then the printed plan: optional `Counterparty.save` (recipient), `InternetDocument.save` (waybill A), the same save again (B, idempotency test), `getDocumentList` (find back by reference and `Ref`), `getStatusDocuments` (with and without the sender phone), the label PDFs from `my.novaposhta.ua`, `InternetDocument.delete`, a check that A and B are gone, and a `finally` that deletes again whatever is not confirmed gone | one or two waybills, deleted in the same run; with `--create-recipient` a recipient entry in the address book that is NOT deleted |

Without `--confirm` the `write` stage prints its plan and exits 2 before any call. Each waybill carries `InfoRegClientBarcodes` = `FLUXKIT-SPIKE-<UTC timestamp>-<random>`, the description "Fluxkit API check, delete", the parcel weight and declared value of the flags, `WarehouseWarehouse`, payer `Recipient` and `Cash` unless overridden. It is never handed in, so it should cost nothing; check the cabinet after the run anyway.

#### How a human runs it

The key and personal data come from the environment only; never put them on the command line (shell history) or in a file in the repository. Use a test key if the cabinet allows one, and delete or expire it after the spike.

```bash
# 0. Self-test (local stub server, no network): redaction and stage gating.
node scripts/spikes/nova-poshta-verify.mjs --self-test

# 1. Key-less probes (safe anywhere).
node scripts/spikes/nova-poshta-verify.mjs --stage keyless --out nova-poshta-findings-keyless.json

# 2. Read-only, with the key typed at a hidden prompt (not in history).
read -rs NOVA_POSHTA_API_KEY && export NOVA_POSHTA_API_KEY
node scripts/spikes/nova-poshta-verify.mjs --stage readonly --out nova-poshta-findings-readonly.json
#    Optional: print the sender counterparty and contact refs to the terminal only, to fill step 3.
node scripts/spikes/nova-poshta-verify.mjs --stage readonly --show-sender-refs --out nova-poshta-findings-readonly.json

# 3. Write: first without --confirm to read the plan (exits 2, nothing sent), then with it.
read -rs NP_SPIKE_SENDER_PHONE && export NP_SPIKE_SENDER_PHONE           # 380XXXXXXXXX
read -rs NP_SPIKE_RECIPIENT_PHONE && export NP_SPIKE_RECIPIENT_PHONE     # a test recipient the owner controls
node scripts/spikes/nova-poshta-verify.mjs --stage write \
  --sender-city-ref <uuid> --sender-warehouse-ref <uuid> \
  --sender-counterparty-ref <uuid> --sender-contact-ref <uuid> \
  --recipient-city-ref <uuid> --recipient-warehouse-ref <uuid> \
  --recipient-counterparty-ref <uuid> --recipient-contact-ref <uuid>
node scripts/spikes/nova-poshta-verify.mjs --stage write --confirm <the same flags> --out nova-poshta-findings-write.json
#    Instead of the two recipient refs: --create-recipient with NP_SPIKE_RECIPIENT_FIRST_NAME and
#    NP_SPIKE_RECIPIENT_LAST_NAME exported (creates an address-book entry that stays).

unset NOVA_POSHTA_API_KEY NP_SPIKE_SENDER_PHONE NP_SPIKE_RECIPIENT_PHONE NP_SPIKE_RECIPIENT_FIRST_NAME NP_SPIKE_RECIPIENT_LAST_NAME
```

- Every ref flag also reads `NP_SPIKE_<FLAG_IN_CAPS>` (for example `NP_SPIKE_SENDER_CITY_REF`); `--city-query` (`NP_SPIKE_CITY_QUERY`, default `Київ`) is the public city name used for directory searches. Other flags: `--payer-type Sender|Recipient`, `--payment-method Cash|NonCash`, `--weight-kg`, `--declared-value` (UAH), `--skip-repeat-create`.
- Behind an HTTPS proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (Node 22.21 or later); otherwise calls fail with a transport error.
- Exit codes: `0` done; `1` a stage call failed (findings are still written, the summary says which); `2` usage error or refusal, nothing sent; `3` the write stage could not confirm that every spike waybill is deleted: the last line names their numbers, delete them by hand in the business cabinet.

#### Reading the findings

- The terminal ends with the plan's list (`H01` to `H34`), each `CONFIRMED`, `DIFFERENT` or `NOT TESTED` with the observed fact. `DIFFERENT` items must be written into the plan before step 7b.
- The findings JSON (`--out`, default `./nova-poshta-findings.json`, mode 600, git-ignored by `nova-poshta-findings*.json`) holds `hypotheses`, `facts` per stage and `calls`: per call the label, model and method, whether a key was sent, HTTP status, content type and encoding, latency, response bytes, header names, rate-limit-like headers, cookie names, envelope keys, `success`, data count, data shape and error, warning and info codes with scrubbed texts.
- Shapes are field names and types only: strings become a class (`uuid`, `digits(14)`, `decimal`, `datetime(YYYY-MM-DD HH:MM:SS)`, `text(cyrillic)`, ...), never their value. Explicit values are kept only for public dictionaries (warehouse types, service and cargo types, city names of the search) and counts.
- Never recorded: the key (also not URL-encoded; every output is scrubbed for it), phones and recipient names (also scrubbed), request URLs and bodies (the label URL carries the key), sender names and refs (only with `--show-sender-refs`, and then on the terminal only). Carrier texts are cut to 200 characters with long digit runs replaced.
- Still review the file before sharing it: it describes the shape of the owner's account (counts, field names). Copy the facts into the plan, not the file.

#### Self-test

`--self-test` starts a local stub of the carrier on `127.0.0.1` (it echoes the key, phones and names back on purpose) and runs: refusal without a key, refusal of `write` without `--confirm` or with missing inputs (no request reaches the stub), an unknown flag, `keyless` (the real key is never sent), `readonly` with a key and with a rejected key, `write` end to end (both waybills deleted, label `%PDF-`, Kyiv clock), a failed first delete retried in `finally`, a thrown error mid-stage (cleanup still deletes), a cleanup that cannot delete (exit 3 with the leftovers named). After each run it asserts that no secret or personal value appears in the terminal output or the findings file.
