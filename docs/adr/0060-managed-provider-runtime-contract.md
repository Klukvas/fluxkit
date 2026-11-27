# 0060. Managed provider runtime contracts and credential bundles

Status: accepted refinement of the owner-approved [integrations plan](../plans/2026-11-16-admin-integrations.md), implemented by PR 1 of the [slice 2 design](../plans/2026-11-27-integrations-slice2-payments-shipping.md), section 0 (2026-11-27).

Supersedes only ADR 0058's rule that each secret purpose appears at most once per provider (decision 2 and its one-field version consequence in decision 5). ADR 0058's encryption, write-only data, permissions, revision, precedence, audit and retention rules remain. This ADR does not activate managed payment or shipping providers.

## Context

- LiqPay needs public and private fields in one outbound version. Rejecting duplicate purposes hides an otherwise valid installed package.
- A plugin needs a typed factory and restricted transport context to work with saved bundles without reading the environment or importing API internals.
- Owners need metadata for retained versions and explicit read-only credential checks. These must not weaken revocation, expose keys or turn saving into a remote operation.

## Decision

1. Allow several distinct declared fields for a purpose. Preserve maximum-eight declarations, unique field/env names and the provider-owned env prefix. Every field for that purpose is required for completeness.
2. Every save creates a generation containing the changed field and retained fields from a candidate or active bundle of the same purpose/environment only. Decrypt and reseal retained fields under fresh secret row IDs/nonces and the new generation; fail the complete save on any error. Retire only the superseded candidate atomically. A different environment starts a new bundle without cross-environment cloning.
3. Add optional `fluxkit.environments` with bounded distinct values, member default and own-prefix env variable. No descriptor means fixed `default`. The existing secret PUT accepts optional `environment`; absent uses the candidate environment, else the manifest default. Presence of the declared environment variable locks the value (blank selects the manifest default); an invalid value makes the integration unavailable at discovery, with a code-only log. Saves and checks of another environment answer `409 integration_env_override` before step-up/decryption/network. Reads expose `environmentSource` (`env` or `store`), effective `environment` and bounded version/environment metadata, with no new history or environment route.
4. Publish pure factory, optional check/identity/locator, context and transport types through core; retain one-argument email factories. Runtime eligibility is validated exports/capabilities, with no marker. Exact signatures and bounds are in the [managed provider contract](../contracts/integrations.md).
5. Explicit owner checks use saved complete candidate/active/draining versions, strict shared limits and a 10-second timeout. Missing hooks return `not_supported`. Start each actual transport synchronously under integration/version authority locks, commit before awaiting remote completion; terminal revoked versions never gain authority again. Audit only safe codes/IDs after the call.
6. Preserve v1 AAD unchanged. Migration 0022 adds version `environment` with default/backfill `default`, bounds, immutable identity and legal lifecycle enforcement. Migration 0022 does not touch `email_message`; the alert key `integration.security_alert` fits the existing dotted grammar. Its locked rollback preflight refuses any non-default environment or any version with more than one secret row, preserving bundle identity. No AAD version/provenance or verification-material schema is introduced.
7. After credential-change/activate/disable/revoke and their audit commit, try to enqueue the code-only `integration.security_alert` through the existing outbox for each active owner, using the inserted audit-row ID returned by `AdminAuditWriter.record` and each owner ID for stable dedupe, with configured `DEFAULT_LOCALE`. Lookup/render/enqueue failure cannot affect the mutation. Email off enqueues nothing; no separate alert account/table. Audit remains durable if a crash loses the best-effort mail.
8. Keep existing managed email activation/routing. Payment/shipping stay unavailable until later safety PRs supply exact resource bindings, provider adapters and required identity/revocation handling. No legacy cutover helper or commerce runtime activation ships in PR 1.

## Consequences

- Paired credentials remain one immutable unit; changing one key cannot copy ciphertext into a different generation or environment.
- Reads remain metadata-only. Explicit checks may call providers without saving an activation decision; a prior success never substitutes for authority at use time.
- Migration rollback is deliberately guarded. Master-key rewrap and candidate cleanup remain slice 3, with their own design and verification.
- No new dependency, permission, env variable, payment state or order-total rule is introduced.
