import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderMetadata,
  type EmailProviderPort,
} from "@fluxkit/core";

/** Injection token: the code of the one provider that was loaded, or `null` for `none`; the registry must find exactly it. */
export const LOADED_EMAIL_PROVIDER_CODE = Symbol("fluxkit:loaded-email-provider-code");

/** Every method of `EmailProviderPort` the API calls; a marked class that lacks one stops the startup. */
const PORT_METHODS = ["send"] as const satisfies readonly (keyof EmailProviderPort)[];

/** Read-only view of the registry for the code that sends mail. */
export interface EmailProviderSource {
  /** The active provider, `undefined` with `EMAIL_PROVIDER=none`. */
  get(): EmailProviderPort | undefined;
  /** Whether a provider is configured (`emailDelivery` of `GET /store/config` and `GET /admin/config`). */
  deliveryEnabled(): boolean;
}

function implementsPort(value: unknown): value is EmailProviderPort {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!PORT_METHODS.every((method) => typeof candidate[method] === "function")) {
    return false;
  }
  const capabilities = candidate.capabilities as Record<string, unknown> | null | undefined;
  return (
    typeof capabilities === "object" &&
    capabilities !== null &&
    typeof capabilities.idempotencyKeys === "boolean" &&
    typeof capabilities.maxRecipients === "number" &&
    Number.isSafeInteger(capabilities.maxRecipients) &&
    capabilities.maxRecipients >= 1
  );
}

/**
 * Finds the email provider once, at startup (ADR 0031 decision 4; the technique of `ShippingProviderRegistry`): every Nest
 * provider whose class carries `EMAIL_PROVIDER_METADATA` (`SetMetadata(EMAIL_PROVIDER_METADATA,
 * emailProviderMetadata(code))`). Core and this app import no provider package. Startup fails loudly (never a skipped
 * provider) when
 * - a marked class is malformed (bad code, not a static provider, no `send` or capabilities, `code` differs from the
 *   metadata),
 * - two classes declare the same code (exactly one provider is active),
 * - the provider named by `EMAIL_PROVIDER` contributes no marked class, or a marked class exists although
 *   `EMAIL_PROVIDER` is `none` or names another code.
 */
@Injectable()
export class EmailProviderRegistry implements OnApplicationBootstrap, EmailProviderSource {
  private readonly logger = new Logger(EmailProviderRegistry.name);
  private provider: EmailProviderPort | undefined;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(LOADED_EMAIL_PROVIDER_CODE) private readonly expectedCode: string | null,
  ) {}

  onApplicationBootstrap(): void {
    this.discover();
    // The observable of the CI matrix (scripts/feature-matrix.sh): no route, so no new public contract.
    this.logger.log(`Email provider loaded: ${this.provider?.code ?? "none"}`);
  }

  /** Scans the providers and replaces the registry; called once at bootstrap (public so a test can assert on a fresh scan). */
  discover(): void {
    const found = new Map<string, EmailProviderPort>();
    // `getProviders({ metadataKey })` only knows decorators made by `DiscoveryService.createDecorator`; a provider package
    // marks itself with the plain `SetMetadata`, so the class of every provider is asked for the key here.
    for (const wrapper of this.discovery.getProviders()) {
      const target: unknown = wrapper.instance?.constructor ?? wrapper.metatype;
      if (typeof target !== "function") {
        continue;
      }
      const raw: unknown = Reflect.getMetadata(EMAIL_PROVIDER_METADATA, target);
      if (raw === undefined) {
        continue;
      }
      const name = target.name === "" ? String(wrapper.name) : target.name;
      let code: string;
      try {
        code = emailProviderMetadata((raw as { code?: string }).code as string).code;
      } catch (error) {
        throw new Error(
          `Email provider ${name} declares an invalid code: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const instance: unknown = wrapper.instance;
      // A request-scoped (or transient) provider has no single instance to call: its placeholder has no dependencies.
      if (!wrapper.isDependencyTreeStatic() || wrapper.isTransient || !implementsPort(instance)) {
        throw new Error(
          `Email provider ${name} ("${code}") must be a static provider implementing EmailProviderPort (send and the capabilities).`,
        );
      }
      if (instance.code !== code) {
        throw new Error(
          `Email provider ${name}: its code "${String(instance.code)}" differs from the code "${code}" in its metadata.`,
        );
      }
      if (found.has(code)) {
        throw new Error(`Email provider code "${code}" is declared twice (${name} is the second).`);
      }
      found.set(code, instance);
    }
    if (this.expectedCode !== null && !found.has(this.expectedCode)) {
      throw new Error(
        `Email provider "${this.expectedCode}" is enabled but its module contains no provider marked with EMAIL_PROVIDER_METADATA for that code.`,
      );
    }
    for (const code of found.keys()) {
      if (code !== this.expectedCode) {
        throw new Error(
          `Email provider "${code}" was found but EMAIL_PROVIDER is ${this.expectedCode === null ? "none" : `"${this.expectedCode}"`}.`,
        );
      }
    }
    this.provider = this.expectedCode === null ? undefined : found.get(this.expectedCode);
  }

  get(): EmailProviderPort | undefined {
    return this.provider;
  }

  deliveryEnabled(): boolean {
    return this.provider !== undefined;
  }
}
