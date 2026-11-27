# Managed integration provider contract

Additive extension of the provider package contracts in [config](config.md), [ADR 0058](../adr/0058-managed-integration-credentials.md) and [ADR 0060](../adr/0060-managed-provider-runtime-contract.md). Pure types are exported by `@fluxkit/core` from `src/integrations/provider-runtime.ts`. The API owns persistence, encryption, authorization and transport admission. Packages never import API internals.

## Installed-package metadata

| Declaration | Contract |
|---|---|
| `fluxkit.provider`, `fluxkit.kind` | Existing bounded provider code and `email`, `payment` or `shipping`; package discovery remains dynamic and excludes test-only packages in production. |
| `fluxkit.secrets` | Optional array of at most eight `{field, purpose, env}` entries. `field` matches `[a-z][a-z0-9_]{0,31}`; `purpose` is `outbound` or `webhook`; env names match `[A-Z][A-Z0-9_]{0,63}` and start with this provider's uppercase code plus `_`. Field and env names are unique. Several fields may share a purpose: all are required for a complete bundle. Absent/empty secrets means no credential integration. |
| `fluxkit.environments` | Optional `{values: string[], default: string, env: string}`. One to eight distinct values, each matching the field-code bound; `default` belongs to `values`; `env` obeys the variable/prefix rule above. Absent means a fixed `default` environment without a selector. API metadata renames `env` to `envVariable`. |

Listing a package or exporting a factory never enables it. PR 1 keeps payment/shipping activation unavailable until their binding and revocation safety paths are implemented. Existing env registries and configured-provider startup failures remain unchanged; no runtime marker or provider-name allowlist grants managed activation.

## Entry exports

Type signatures below describe the extension point; construction is synchronous and does no network I/O. Complete secrets are a readonly field-to-string record from one purpose/version/environment. Secrets and context are server-only.

| Export / type | Contract |
|---|---|
| `CreateOutboundClient<K>` / `createOutboundClient(secrets, context)` | Produces the existing port for the kind (`EmailProviderPort`, `PaymentProviderPort` or `ShippingProviderPort`). Email ports are validated at activation; payment/shipping activation is refused until their runtime ships. Email validation checks the returned code, required methods and capabilities. Existing one-argument email factories remain compatible. |
| `CheckCredentials` / `checkCredentials(secrets, context, signal)` | Optional async `CredentialCheckOutcome`: `{code, retryAfterSeconds?}`. `CredentialCheckCode` is `ok`, `invalid_credentials`, `unavailable`, `rate_limited`, `not_supported`; retry is an integer 0–86400. Missing hook means `not_supported`, never a fabricated success. |
| `AccountIdentity` / `accountIdentity(secrets, context, signal)` | Optional async `AccountIdentityResult`: `{ok: true, identity: string}` or `{ok: false, code, retryAfterSeconds?}` with a check failure code. Identity is a canonical opaque UTF-8 value of 1–256 bytes, server-only. PR 1 declares this hook without enrolling payment merchants. |
| `LocateWebhook` / `locateWebhook(input)` | Optional pure synchronous `PaymentWebhookInput` → `WebhookLocation` or null. Location has `reference?` and/or `providerPaymentId?`, at least one bounded validated identifier. It is a lookup hint, never signature verification or a payment fact. Managed payment adapters with webhooks require it when their runtime is enabled in a later PR. |
| `ManagedProviderExports<K>` | Kind-appropriate factory plus optional check, identity and locator hooks. Existing `validateIntegrationSecret(field, value)` stays synchronous and enforces format without disclosing the input. |

Provider code must use no environment reads in managed factories. Optional hooks cannot return raw provider text/errors or silently select another credential. No live payment, refund, shipment or email send is a credential check.

## Context and final transport gate

- `ManagedProviderContext` is readonly `kind`, `providerCode`, `versionId`, `environment`, API-owned `now()` and `transport`. No database executor, raw logger, environment object, arbitrary URL setting, verifier-material store or alternate-version selector is exposed.
- `IntegrationTransportGate.start<T>(signal, start)` invokes a synchronous thunk returning `{completion: Promise<T>}`. The thunk starts the actual transport immediately: no await, queue or timer before request initiation.
- The API checks authority under integration then credential-version `FOR SHARE` locks, invokes the thunk there, commits/releases the locks, and only then awaits `completion`. Every retry, page, JWT acquisition and public-key refresh needs its own gate. A cached client grants no authority.
- A denial throws `CredentialAdmissionDenied`, an Error-shaped interface with `name: CredentialAdmissionDenied` and code `credential_revoked` or `credential_unavailable`; provider adapters preserve that code-only boundary. No HTTP status/body, request headers, credential or underlying cause crosses it.
- Revoked is terminal. A revoke committed before transport admission prevents the thunk; an already-started request may finish. A transport started before a failed admission-transaction commit is ambiguous and must never be treated as definitely unsent.
- PR 1 uses this authority for explicit saved-version checks. Implementing payment/shipping adapters and resource bindings is separate work; the contract does not claim those paths already use it.

## Bundle identity and API

A save creates a new generation. It may clone retained declared fields only from the same purpose and environment, decrypting and resealing with fresh row IDs and nonces; unreadable material aborts the whole transaction. Changing environment starts without fields from the previous environment. Candidate retirement is version-wide. Existing AES-256-GCM v1 AAD stays unchanged; migration 0022 protects immutable version identity and legal lifecycle transitions. Rollback locks the version and secret tables and refuses non-default environments or any version with more than one secret row. Migration 0022 never touches `email_message`; `integration.security_alert` fits the existing dotted-key grammar.

Reads expose at most 20 recent non-retired versions with metadata only. Optional environment selection is on the existing secret PUT body; there are no new environment/history routes. Exact DTOs, check budgets, errors, lifecycle actions and best-effort owner alerts are in the [Integrations API](../api/integrations.md).

A declared environment variable takes precedence whenever present, including blank (manifest default). Invalid values make the installed integration unavailable with a code-only log. Saves and checks must match the locked environment before step-up, decryption or network; reads expose `environmentSource` and effective `environment`, and the admin selector is locked for source `env`.
