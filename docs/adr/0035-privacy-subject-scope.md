# 0035. Privacy subject scope: what an export or an erasure reaches

Status: accepted 2026-10-29 (fix of the privacy review `docs/plans/2026-10-29-privacy-review.md`, findings F1 to F3, taking the reviewer's suggested fix; PR #177 must not merge without it). Supersedes in part ADR 0033 decision 6 (the sentence "delete the customer's `email_message` rows (by `customer_id` or `to_address`)" and the rule that a subject's orders include every order with its email) and the matching sentences of `docs/api/privacy.md`; ADR 0033 itself is not edited. Changes no schema: no migration, no dependency, no environment variable.

## Context

- ADR 0033 and privacy plan steps 6 and 7 took "the subject's orders" as the orders of the account plus every order whose `email` is the subject's address, and the same for mail rows.
- Registration takes any address without verification (ADR 0031, owner answer 2, "verification is optional"); ADR 0031 says verification "is the prerequisite for attaching guest orders by email later". The review (F1, Blocker) showed an account registered with a guest buyer's address downloading that guest's orders (names, phone, address, payments) through `GET /store/account/data-export` and destroying them through `POST /store/account/delete`.

## Decision

### 1. The scope is a pure core rule (`privacySubjectScope`, `packages/core/src/privacy/subject-scope.ts`)

A subject reaches two things: the rows linked to an account (`customer_id`) and the GUEST rows of an address. The rule:

| Subject | Account rows (`customerId`) | Guest rows of the address (`guestEmail`) |
|---|---|---|
| customer subject (self-service export and deletion; the owner's request by account id), address NOT verified | the account | none |
| customer subject, address verified (`email_verified_at` set) | the account | the account's address |
| email subject (the owner's request by address; identity checked off-band, ADR 0033 decision 1) | the account with that address, if any | the typed address |

- An unverified address proves nothing about who placed a guest order with it, so it reaches nothing beyond the account. The owner can still serve such a person through an email request after checking their identity.
- Verification needs an email provider (ADR 0031). Without one no account is ever verified, so self-service reaches only the account's own rows; guests and guest orders stay with the owner's email requests.
- Inconsistent input (a customer subject without an account, an email subject whose account has another address) is a bug: `RangeError`.
- **Guest rows only (review F2).** The address reaches an order or a mail row only when it belongs to no account (`customer_id IS NULL`). A signed-in customer may type any contact email at checkout (`docs/api/orders.md`, never verified), so an order of account A that carries address V is A's record: it is exported and erased through A (A's own deletion or a request for A), never through a request for V. Core `isInPrivacySubjectScope(scope, {customerId, email})` states the rule for one row.

### 2. One SQL condition per table, shared by every reader and writer

`apps/api/src/privacy/subject.ts` turns the scope into `subjectOrdersCondition` and `subjectMailCondition`, built from `guestOrdersCondition` (`email = X AND customer_id IS NULL`) and `guestMailCondition` (`to_address = X AND customer_id IS NULL`). The lookup (its guest orders and mail count), the export, the erasure preview, the erasure and its blockers all use them, so what is shown, exported, previewed, blocked and erased can never disagree. A spec runs both conditions on real rows and compares them with core `isInPrivacySubjectScope`.

## Consequences

- Self-service by an unverified account exports and erases only the account's own orders and mail rows; a guest order with its address is untouched (regression spec R1 in `apps/api/src/privacy/subject-scope.spec.ts`).
- A verified account that registered after buying as a guest exports and erases those guest orders, as ADR 0033 intended.
- The owner's request for an address no longer exports or anonymises another live account's order that carries it, and no longer counts or deletes that account's mail rows (regression R2). Such an order is erased with its account. The lookup already listed guest orders only; now the export and the erasure match it.
- `privacy_request.result` counts only what was reached.
