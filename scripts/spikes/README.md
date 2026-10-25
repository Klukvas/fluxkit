# Spikes

One-off verification scripts that a human runs by hand. They are not part of any package, build or CI job; `pnpm lint` and `pnpm format:check` cover them like the other `scripts/`.

## `nova-poshta-verify.mjs` (shipping plan step 7a)

Checks the real Nova Poshta API against the "from memory" list of `docs/plans/2026-10-24-shipping.md` section 8 (ADR 0029 decision 11) before the plugin (plan step 7b) is coded. Plain Node 22 ESM, built-in `fetch`, no dependencies.

### Stages

| Stage | Needs | What it calls | Creates on the account |
|---|---|---|---|
| `keyless` | nothing | Error and envelope shapes with no, empty and an invented key; unknown model; invalid JSON; `GET`; `/xml/`; plain `http`; key-less tracking of invented numbers (1, 100, 101); a burst of 10 sequential calls | nothing (no key is sent) |
| `readonly` (default) | `NOVA_POSHTA_API_KEY` | `keyless` first, then: `Address.getWarehouseTypes`, `Common.getServiceTypes`/`getCargoTypes`/`getTypesOfPayers`/`getPaymentForms`/`getTypesOfCounterparties`, `Address.searchSettlements`, `Address.getCities` (search, language variants, country total), `Address.getWarehouses` (pages 1 and 2, whole city, by `Ref`, by number, by type, language variants, unknown city and ref), `InternetDocument.getDocumentPrice` (every service type, one error sample), `getDocumentDeliveryDate`, `Counterparty.getCounterparties` (Sender), `getCounterpartyContactPersons`, `getCounterpartyAddresses`, `InternetDocument.getDocumentList` (last 7 days) | nothing |
| `write` | the key, `--confirm`, sender and recipient inputs | `keyless` first, then the printed plan: optional `Counterparty.save` (recipient), `InternetDocument.save` (waybill A), the same save again (B, idempotency test), `getDocumentList` (find back by reference and `Ref`), `getStatusDocuments` (with and without the sender phone), the label PDFs from `my.novaposhta.ua`, `InternetDocument.delete`, a check that A and B are gone, and a `finally` that deletes again whatever is not confirmed gone | one or two waybills, deleted in the same run; with `--create-recipient` a recipient entry in the address book that is NOT deleted |

Without `--confirm` the `write` stage prints its plan and exits 2 before any call. Each waybill carries `InfoRegClientBarcodes` = `FLUXKIT-SPIKE-<UTC timestamp>-<random>`, the description "Fluxkit API check, delete", the parcel weight and declared value of the flags, `WarehouseWarehouse`, payer `Recipient` and `Cash` unless overridden. It is never handed in, so it should cost nothing; check the cabinet after the run anyway.

### How a human runs it

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

### Reading the findings

- The terminal ends with the plan's list (`H01` to `H34`), each `CONFIRMED`, `DIFFERENT` or `NOT TESTED` with the observed fact. `DIFFERENT` items must be written into the plan before step 7b.
- The findings JSON (`--out`, default `./nova-poshta-findings.json`, mode 600, git-ignored by `nova-poshta-findings*.json`) holds `hypotheses`, `facts` per stage and `calls`: per call the label, model and method, whether a key was sent, HTTP status, content type and encoding, latency, response bytes, header names, rate-limit-like headers, cookie names, envelope keys, `success`, data count, data shape and error, warning and info codes with scrubbed texts.
- Shapes are field names and types only: strings become a class (`uuid`, `digits(14)`, `decimal`, `datetime(YYYY-MM-DD HH:MM:SS)`, `text(cyrillic)`, ...), never their value. Explicit values are kept only for public dictionaries (warehouse types, service and cargo types, city names of the search) and counts.
- Never recorded: the key (also not URL-encoded; every output is scrubbed for it), phones and recipient names (also scrubbed), request URLs and bodies (the label URL carries the key), sender names and refs (only with `--show-sender-refs`, and then on the terminal only). Carrier texts are cut to 200 characters with long digit runs replaced.
- Still review the file before sharing it: it describes the shape of the owner's account (counts, field names). Copy the facts into the plan, not the file.

### Self-test

`--self-test` starts a local stub of the carrier on `127.0.0.1` (it echoes the key, phones and names back on purpose) and runs: refusal without a key, refusal of `write` without `--confirm` or with missing inputs (no request reaches the stub), an unknown flag, `keyless` (the real key is never sent), `readonly` with a key and with a rejected key, `write` end to end (both waybills deleted, label `%PDF-`, Kyiv clock), a failed first delete retried in `finally`, a thrown error mid-stage (cleanup still deletes), a cleanup that cannot delete (exit 3 with the leftovers named). After each run it asserts that no secret or personal value appears in the terminal output or the findings file.
