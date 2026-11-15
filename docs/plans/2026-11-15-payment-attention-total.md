# Admin workspace: payments needing attention

- Date: 2026-11-15. Implemented on branch `feature/payment-attention-counter`; in review. Verification results at the end.
- Owner approval: exactly one read-only, additive filtered `total` on `GET /admin/payments`, consumed by the sixth home counter. Core admin capability; no feature flag.

## Findings and API decisions

- `AdminPaymentsController.list` validates `needsAttention=true|false|absent`, limit and opaque cursor; `AdminPaymentsService.list` calls `PaymentsRepository.listPage`, then batches refunds and journal reads through `viewsOf`. Original response: `{items, limit, nextCursor}`; implemented response includes `total`.
- Add required non-negative integer `total` to `adminPaymentPageSchema` and the response: `{items, total, limit, nextCursor}`. Count payment attempts, not distinct orders, attention codes or refunds. Leave `AdminPaymentList` (per-order attempts) unchanged.
- Add repository `countForAdmin(db, filter)` taking only the same `needsAttention` filter; share the filter predicate with `listPage`. True selects `needs_attention`, false selects its negation, absent adds no predicate. The column is non-null.
- Exactly one aggregate COUNT query per valid list request, regardless of page size; no cursor, limit, offset, ordering or per-row reads in that query. Keep keyset ordering, limit-plus-one and `nextCursor` unchanged. An empty page after a cursor can still have a positive `total`.
- Count directly from `payment`: the list's join to `sales_order` only retrieves the number; the non-null `order_id` FK with `ON DELETE RESTRICT` guarantees one matching order per payment. No other list filter or join exclusion exists.
- For true, use the static boolean SQL predicate shared with the list so it directly implies migration 0011's `WHERE needs_attention`; avoid relying on a generic prepared boolean parameter plan to prove that implication. Parameterize cursor/user values as before.
- **No migration is needed.** `apps/api/drizzle/0011_append_only_truncate_payment_list.sql` already creates `payment_attention_created_at_id_idx` on `(created_at, id)` with that predicate and `payment_created_at_id_idx` for all rows; schema declarations agree.

| Filter | Existing index suitability and cost |
|---|---|
| true | Partial index is eligible for COUNT; an index-only scan is possible subject to MVCC visibility, otherwise heap visibility checks occur. Exact count still visits all matching entries, not O(1); planner may prefer a sequential scan on small/dense tables. |
| false | Partial index cannot help. Full `payment_created_at_id_idx` serves ordered paging but lacks `needs_attention`; count usually needs a sequential scan/filter, or a full index scan with heap filtering. O(all payments). |
| absent | Full index can support an index-only COUNT, or planner may choose a sequential scan; O(all payments). |

- Accept these costs for this admin read: the home requests only true, and false/absent are explicit list reads. Verify real plans/timings before completion; do not invent performance claims, cache counts or add indexes if large histories prove too slow—escalate that separately.
- **No shared transaction/snapshot:** keep ordinary separate reads, as `AdminOrdersService.list` already does (page, count, batched views). Each statement sees committed data; concurrent attention changes/inserts can make page and count disagree briefly. This operational counter is not an accounting report; avoid extending transaction lifetime across view reads. Document this consistency limit. A normal READ COMMITTED transaction alone would not provide a shared snapshot.
- `total` never depends on cursor or limit; repeated requests can differ only because underlying rows change. Count failure fails the response, never substitutes zero.

## Permissions: request conflict resolved within scope

- `apps/admin/src/permissions.ts` delegates `canRun` to `ADMIN_OPERATIONS`; `packages/api-client/src/admin-operations.ts` maps `listPayments` to `orders.read`. `apps/admin/src/routes.ts` gates the payments route with that operation; `PATHS.payments` is `/payments` (browser `/admin-ui/payments`).
- **The requested “viewer allowed” assertion conflicts with existing authorization:** `packages/core/src/auth/roles.ts` gives viewer only `catalog.read`; existing API tests explicitly expect viewer 403. Owner and manager hold `orders.read` and are allowed. Preserve this policy; granting viewer access is an unapproved auth red zone.
- Test an `orders.read`-only principal as allowed (no write/refund permission required), a principal without it as 403, built-in viewer as 403 and anonymous as 401. UI checks permissions, never role names.

## Admin composition

- Add counter id `paymentsAttention`, operation `listPayments`, query `{needsAttention: true, limit: 1}`, target `PATHS.payments`. Extend `readCounter`'s typed client Pick and switch. No offset, cursor walk, polling or payment-area import.
- Order: awaiting payment, paid awaiting fulfilment, **payments needing attention**, customers, draft products, active products; retain existing relative order while grouping payment work with orders.
- Reuse `HomeWorkspace`'s per-counter `useResource`/AbortSignal and `CounterView`: own loading label, local error and labelled Retry, forbidden state without retry, genuine zero still linked. An error must not render 0 or block the other five counters/checklist.
- Display `response.total` through existing `formatTotal`/`Intl.NumberFormat(locale)`, not `items.length`, compact rounding or money formatting.
- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; remove `xl:grid-cols-5`, so lg/xl both have three columns (two rows for six). Preserve `min-w-0`, text wrapping, tokens and native links; verify no overflow at 360 px in uk/en.
- Add `home.counter.paymentsAttention` to `apps/admin/src/messages/{uk,en}/home.json`, reusing navigation's existing `page.payments.title` wording: “Платежі на перевірку” / “Payments to review”. Keep home messages lazy; no payments message bundle needed. Shared loading/error/forbidden/retry keys already exist.

## Files for implementation

| Files | Change |
|---|---|
| `apps/api/src/payments/admin/admin-payments.controller.ts`, `admin-payments.schemas.ts`, `admin-payments.service.ts` | Describe additive total/consistency; schema field; filtered count orchestration. |
| `apps/api/src/payments/attempts/payments.repository.ts` | Shared filter predicate and one aggregate count; no payment writes. |
| `apps/api/src/payments/admin/admin-payments.spec.ts` | Real-Postgres total/filter/cursor and unchanged permission coverage. |
| `packages/api-client/src/admin-types.ts`, `admin-contract.spec.ts` | Required `AdminPaymentPage.total: number`; update `paymentPage` OpenAPI parity shape. Client method/operation/permission remain unchanged. |
| `apps/admin/src/areas/home/workspace-model.ts`, `workspace-view.tsx` | Sixth definition/typed read; three-column large grid. Existing loader is reused unchanged. |
| `apps/admin/src/messages/uk/home.json`, `apps/admin/src/messages/en/home.json` | New counter label. |
| `apps/admin/src/areas/home/workspace-model.spec.ts`, `workspace-view.spec.tsx` | Six-counter ordering, queries, permissions, localized totals and states; update index-based fixtures. |
| `apps/admin/e2e/tests/home.e2e.ts`, `roles.e2e.ts` | Payment query/response total, navigation, isolation, layout and all three roles. |
| `docs/api/payments.md`, `docs/api/openapi.json`, `docs/contracts/api.md`, `CHANGELOG.md` | Endpoint row, generated response schema, existing Admin payments contract row/rules, additive minor API change plus home counter. |
| `docs/HANDOFF.md`, `docs/plans/2026-11-13-admin-shell-redesign.md` | Supersede the payment-counter exclusion after implementation; record actual status/checks. |

- Export OpenAPI with `pnpm openapi:export`; never hand-edit JSON. API client types are handwritten, with contract tests. Update any typed payment-page test fixtures revealed by typecheck, only to supply the new total.
- `docs/contracts/api.md` explicitly lists this endpoint under “Admin payments”: update its response and cursor-independent filter/consistency rules; leave general offset pagination and unrelated endpoints alone.
- Handoff cleanup: remove the obsolete payment “Dropped” sentence in the PR 3 bullet and “Possible follow-up” in item 2b; link this plan and record actual implementation state/date without rewriting PR 299 history as if it included this API change.
- Redesign-plan cleanup: replace the payment exclusion in the evidence row near line 329 and remove only its payment portion from “Dropped” near line 395; preserve low-stock/revenue exclusions and historical five-counter results, clearly superseded by this follow-up.
- `apps/admin/README.md` documents the attention page, but currently has no home-counter section/count to correct; no README cleanup is necessary. Existing `docs/files/admin.md` workspace entries and API/client file maps remain accurate; no files are added/moved/renamed in implementation, so no file-map edit is needed unless responsibilities change.

## Tests and acceptance

- API: create several attention and non-attention attempts; assert true/false/absent totals against independently known fixture counts, using database baselines because this suite retains rows across tests. Limit 1 and larger limits yield the same total; subsequent cursors (including beyond the last match) retain the filter's full total. Cover zero matches, ties, unchanged cursor validation and the existing clearing scenario's reduced attention total.
- API permissions: preserve the existing role walk and add a focused `orders.read`-only principal case. Verify the read makes no provider calls or payment/refund/journal writes; review that exactly one COUNT and the existing batch reads occur, with no N+1.
- Model: exact payment query and AbortSignal, permission inclusion/exclusion, order/target and response total larger than returned items. View: payment card loading/error/retry/forbidden/zero/large value in both languages; no masked error, native link name and Retry focus preserved.
- E2E: extend `home.e2e.ts`'s query matcher for `needsAttention` without offset; expect six links for owner/manager and compare payment text with real API `total`. Use existing `e2e/support/payments-db.ts` fixtures for multiple attention rows; navigate to `/admin-ui/payments` and confirm its attention read.
- E2E: delay/fail only the payment counter read, then retry against the real API; other counters remain ready. Verify keyboard navigation, checklist order and 360 px uk/en overflow plus desktop three-column layout. Viewer retains two catalog counters, no payment link/read; extend `roles.e2e.ts`'s forbidden-read guard to include payments. Direct viewer API access stays 403.

## Risks and verification commands (implementation phase only)

- Risks: exact counts grow with history; concurrent-read drift is intentional; missing required totals break typed fixtures; index-based tests and five-link assertions need updating; large labels/numbers must wrap. Preserve lazy loading and existing bundle budgets.
- Use Node 22/pnpm 10.28.0. Real Postgres integration database must end `_test`; supply service variables from the test environment without printing secrets. Run one DB suite at a time. E2E needs a separately authorized disposable `_e2e_test` database: its harness resets schemas, never use development/production data.
- Run separately and record exit codes: `pnpm build`; `pnpm openapi:export`; `pnpm lint`; `pnpm format:check`; `pnpm typecheck`; `pnpm check:boundaries`; `pnpm check:env`; `pnpm check:docs`.
- Focused API: `pnpm --filter @fluxkit/api test src/payments/admin/admin-payments.spec.ts src/openapi.spec.ts`; client: `pnpm --filter @fluxkit/api-client test`.
- Admin: `pnpm --filter @fluxkit/admin test` (workspace, message/permission guards and build budget); browser: `pnpm --filter @fluxkit/admin test:e2e home.e2e.ts roles.e2e.ts payments.e2e.ts` after rebuilding. Run `pnpm test` for final integration regression coverage with real services.
- Inspect read-only `EXPLAIN (ANALYZE, BUFFERS)` for the actual true/false/absent COUNT queries on representative test data; record plans, row counts and timings. Index eligibility is established by schema/predicate inspection here; planner choice/performance is not yet measured.
- Final review checks actual diff, tests, permission conflict, unchanged payment behavior and documentation consistency; report unrun checks honestly. Implementation verification is recorded below; independent review is the orchestrator's next step.

## Out of scope / red zones

- Payment creation/status transitions, provider calls, refund calculations or workflows, attention-setting/clearing semantics, pricing/order totals and stock logic.
- Auth or role/permission changes (including giving viewer `orders.read`), new endpoints/filters, breaking contracts or changes beyond this additive filtered total.
- Migrations/schema/index changes, dependencies, feature flags, theme tokens, caching/materialized counters, low-stock/revenue metrics and unrelated cleanup. Stop and obtain separate approval if any becomes necessary; none is planned.
- Secret edits, live-provider verification, production data changes, destructive operations outside explicitly authorized disposable test fixtures, commits/pushes/deployments and external writes.

## Implementation verification (2026-11-15)

- Implemented on `feature/payment-attention-counter`. No migration, dependency, permission or payment behavior change.
- Node 22.23.5, outside the Developer's sandbox (which blocked ports and the database), run by the orchestrator: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries`, `pnpm check:env` all exit 0; `pnpm openapi:export` (then Prettier) changes only the `/admin/payments` description and the new required `total`.
- Real Postgres, Redis, Meilisearch: `pnpm --filter @fluxkit/api exec vitest run src/payments/admin/admin-payments.spec.ts src/openapi.spec.ts`: 37 passed. `pnpm --filter @fluxkit/api-client test`: 1,399 passed. `pnpm --filter @fluxkit/admin test`: 2,183 passed (bundle guards included).
- Admin Playwright (`pnpm --filter @fluxkit/admin test:e2e home roles payments`; the filter also matches other files): 79 passed, 4 skipped (blog, feature off).
- `EXPLAIN select count(*)::int from payment where payment.needs_attention` (test database): `Bitmap Index Scan on payment_attention_created_at_id_idx`, i.e. the count uses the existing partial index. False/absent were not measured (not used by the home page).
- QA: separate Codex review (`codex exec review --uncommitted`, a different model than the Developer): no actionable findings.
