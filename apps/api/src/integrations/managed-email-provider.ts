import {
  emailProviderFailure,
  type EmailProviderPort,
  type EmailProviderResult,
  type EmailSendOptions,
  type EmailSent,
  type OutgoingEmail,
  type ProviderAbortSignal,
} from "@fluxkit/core";
/** The stored credential the client was built from. */
export interface ManagedEmailSnapshot {
  readonly providerCode: string;
  readonly versionId: string;
  readonly client: EmailProviderPort;
}

/** The authority re-read that happens before a stored credential is used. */
export interface EmailSendAuthority {
  admit(versionId: string, messageId: string): Promise<boolean>;
  release(messageId: string, versionId: string): Promise<void>;
}

/**
 * The email provider the registry exposes while `EMAIL_PROVIDER` is absent. The first await re-reads authority, so a
 * revocation lands before the provider call. The client itself was built from the stored key, not from the environment.
 */
export class ManagedEmailProvider implements EmailProviderPort {
  readonly code: string;
  readonly capabilities: EmailProviderPort["capabilities"];

  constructor(
    private readonly snapshot: ManagedEmailSnapshot,
    private readonly runtime: EmailSendAuthority,
  ) {
    this.code = snapshot.providerCode;
    this.capabilities = snapshot.client.capabilities;
  }

  async send(
    message: OutgoingEmail,
    options: EmailSendOptions,
    signal: ProviderAbortSignal,
  ): Promise<EmailProviderResult<EmailSent>> {
    const admitted = await this.runtime.admit(this.snapshot.versionId, options.idempotencyKey);
    if (!admitted) {
      return emailProviderFailure("not_sent", { providerCodes: ["credential_revoked"] });
    }
    const result = await this.snapshot.client.send(message, options, signal);
    if (!result.ok && result.reason === "not_sent") {
      await this.runtime.release(options.idempotencyKey, this.snapshot.versionId);
    }
    return result;
  }
}
