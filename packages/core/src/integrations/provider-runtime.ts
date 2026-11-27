import type { EmailProviderPort } from "../email/provider-port.js";
import type { PaymentProviderPort, PaymentWebhookInput } from "../payments/provider-port.js";
import type { ProviderAbortSignal, ShippingProviderPort } from "../shipping/provider-port.js";
import type { IntegrationKind } from "./secrets.js";

/** A synchronous transport start under authority locks; the remote response is awaited after commit. */
export interface IntegrationTransportGate {
  start<T>(signal: ProviderAbortSignal, begin: () => { completion: Promise<T> }): Promise<T>;
}

export interface ManagedProviderContext {
  readonly kind: IntegrationKind;
  readonly providerCode: string;
  readonly versionId: string;
  readonly environment: string;
  readonly now: () => Date;
  readonly transport: IntegrationTransportGate;
}

/** API and plugins recognise the code without importing each other's error classes. No provider text or cause. */
export interface CredentialAdmissionDenied extends Error {
  readonly name: "CredentialAdmissionDenied";
  readonly code: "credential_revoked" | "credential_unavailable";
}

export type CredentialCheckCode =
  "ok" | "invalid_credentials" | "unavailable" | "rate_limited" | "not_supported";
export interface CredentialCheckOutcome {
  readonly code: CredentialCheckCode;
  /** If present, an integer in 0..86400. Runtime boundaries validate this bound. */
  readonly retryAfterSeconds?: number;
}

export type AccountIdentityResult =
  | {
      readonly ok: true;
      /** Canonical opaque UTF-8 identity, 1..256 bytes; server only. */ readonly identity: string;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<CredentialCheckCode, "ok">;
      readonly retryAfterSeconds?: number;
    };

/** An untrusted routing hint, never a signature verdict or payment fact. At least one bounded id is required. */
export type WebhookLocation =
  | { readonly reference: string; readonly providerPaymentId?: string }
  | { readonly reference?: string; readonly providerPaymentId: string };

export type ManagedProviderSecrets = Readonly<Record<string, string>>;
export type ManagedProviderPort<K extends IntegrationKind> = K extends "email"
  ? EmailProviderPort
  : K extends "payment"
    ? PaymentProviderPort
    : ShippingProviderPort;

/** Construction is synchronous and performs no network call. One-argument email factories remain assignable. */
export type CreateOutboundClient<K extends IntegrationKind = IntegrationKind> = (
  secrets: ManagedProviderSecrets,
  context: ManagedProviderContext,
) => ManagedProviderPort<K>;
export type CheckCredentials = (
  secrets: ManagedProviderSecrets,
  context: ManagedProviderContext,
  signal: ProviderAbortSignal,
) => Promise<CredentialCheckOutcome>;
export type AccountIdentity = (
  secrets: ManagedProviderSecrets,
  context: ManagedProviderContext,
  signal: ProviderAbortSignal,
) => Promise<AccountIdentityResult>;
export type LocateWebhook = (input: PaymentWebhookInput) => WebhookLocation | null;

export type ManagedProviderExports<K extends IntegrationKind> = {
  readonly createOutboundClient: CreateOutboundClient<K>;
  readonly checkCredentials?: CheckCredentials;
  readonly accountIdentity?: AccountIdentity;
} & (K extends "payment" ? { readonly locateWebhook?: LocateWebhook } : object);
