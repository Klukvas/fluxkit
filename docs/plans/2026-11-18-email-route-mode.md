# Email route mode

Records the admin choice between an even Resend/Brevo split and Resend-first, and the review fixes of 2026-11-18. The schema is migration `0021_email_route_mode` (unshipped on this branch).

## Behavior

- `email_route_setting` is one row (`id = 1`) with `mode` `equal` or `resend` and a monotonic `turn`.
- `equal`: odd turns start on Resend, even turns on Brevo. The assignment is stored on `email_message.assigned_provider_code` and a retry does not take another turn.
- `resend`: every new message starts on Resend. The chain is not reordered.
- The choice applies whenever both codes are in the send chain. A server chain (`EMAIL_PROVIDER` plus fallbacks) that contains both follows it. A chain with only one of them cannot be shared.
- A cooled-down starter is waited on (`holdStart`). It is not given to the other provider. A definite non-acceptance (`quota_exceeded`, `rate_limited`, `misconfigured`, `not_sent`) is tried on the other.
- `unavailable`, `rejected` and `idempotency_conflict` do not switch providers. A timeout may already have been accepted, and a rejection is about the message (ADR 0056). That is unchanged on purpose.
- A missing row or any other mode throws `email_route_mode_invalid`. An assignment that is not in the chain throws `email_route_assignment_unknown`.
- `assigned_provider_code` allows only `resend` and `brevo`.
- Changing the mode needs `integrations.manage`, the owner's current password, and records `integration.route_changed`.
- Turning both stored keys on is required for the stored split. The audit event stays. The extra "remaining cap" line on the email screen does not: the existing usage meter already shows accepted against the cap.

## Rollback

`0021_email_route_mode.down.sql` drops the column, the table and its journal row. The released down scripts of `0019` and `0020` do not mention `0021`. Tests that roll back an older migration run `0021`'s down script first.
