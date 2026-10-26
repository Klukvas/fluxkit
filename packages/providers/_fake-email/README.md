# @fluxkit/provider-fake-email

Purpose: a TEST-ONLY email provider with code `fake` (ADR 0031, email plan step 4). It implements `EmailProviderPort` in memory, with no network, no clock and no randomness, keeps every mail it accepts in a capture mailbox a test reads, and can be told to fail. It is the fixture for the email matrix modes (`providers-email-fake`, `providers-email-none`, `providers-deleted`) and for tests and e2e suites of the email module. It delivers NOTHING: never enable it in a real shop. `loadEnv` refuses `EMAIL_PROVIDER=fake` when `NODE_ENV=production` (the API does not start).

- Flag: `EMAIL_PROVIDER=fake` (with `EMAIL_FROM`; `STOREFRONT_PUBLIC_URL` defaults outside production).
- Manifest: `"fluxkit": { "provider": "fake", "kind": "email" }` in `package.json`. Codes are unique per kind, so this does not clash with the shipping `fake` in `packages/providers/_fake`.
- Entry: `src/index.ts` exports `providerModule`, loaded dynamically by `apps/api` only when `EMAIL_PROVIDER` is `fake`.
- Variables: `FAKE_EMAIL_CAPTURE_FILE` (optional): an absolute path of a JSON Lines file; every accepted mail is appended as one object (`providerMessageId`, `idempotencyKey`, `from`, `replyTo`, `to`, `subject`, `html`, `text`, `tags`). For end-to-end tests that run the API in another process. Any other value than an absolute path stops the startup (the variable is named, the value never shown).
- Routes, DB tables, migrations: none.
- Extension points used: the email provider loader and registry (`apps/api/src/email/registry`).

## Behaviour
- `send` answers `not_sent` (nothing left the process) for an already aborted signal and for a message that fails core `validateOutgoingEmail`; it records no request for those.
- The recipient `refused@<any domain>` is refused: `rejected` with code `recipient_refused`.
- Idempotency like Resend: a key seen before with the same message replays the first answer (no second copy in the mailbox); the same key with another message is `idempotency_conflict` (`invalid_idempotent_request`).
- Accepted mails get the ids `fake-email-000001`, `fake-email-000002`, ... (counted per instance).
- Its spec runs the core contract check `checkEmailProviderContract`.

## Test hooks
`FakeEmailProvider` has methods beyond the port. A test reaches the instance with `app.get(FakeEmailProvider)` (from this package) or by casting the registry's answer; the hooks work inside one process only.
- `mailbox()`: the capture mailbox, oldest first (`{providerMessageId, idempotencyKey, message}`); `requests()`: every request that passed local validation (refused ones and replays too), the contract suite's observer.
- `failNext({ reason?, providerCodes?, retryAfterSeconds?, quotaPeriod?, times?, afterEffect?, hang? })`: the next `times` (default 1) sends fail. `reason` is any `EmailProviderFailureReason` (`unavailable` by default, `rate_limited`, `rejected`, `misconfigured`, `quota_exceeded`, `idempotency_conflict`, `not_sent`); `retryAfterSeconds` is the service's `retry-after`; `quotaPeriod` (`daily` or `monthly`) only with `quota_exceeded`. `afterEffect: true` accepts and captures the mail but loses the answer, so a retry with the same key must not deliver a second copy. `hang: true` never answers until the abort signal fires, then rejects with its reason (a timeout). A bad description throws at once (`RangeError`).
- `reset()`: forgets the mailbox, the requests, the keys and any planned failure; the numbering restarts.

## How to remove it
Delete `packages/providers/_fake-email` and use `EMAIL_PROVIDER=none` (or another provider). Nothing in core or `apps/api` references it (CI: `scripts/feature-matrix.sh providers-deleted` removes it and checks that `EMAIL_PROVIDER=fake` then refuses to start while lint, types, boundaries and tests stay green).
