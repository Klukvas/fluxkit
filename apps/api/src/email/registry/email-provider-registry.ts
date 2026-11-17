import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  EMAIL_PROVIDER_METADATA,
  emailProviderMetadata,
  isEmailProviderCapabilities,
  type EmailProviderPort,
} from "@fluxkit/core";

/** Injection token: the ordered loaded provider codes; string/null remain compatible with single-provider callers. */
export const LOADED_EMAIL_PROVIDER_CODE = Symbol("fluxkit:loaded-email-provider-code");

/** True when `EMAIL_PROVIDER` is absent and an activated stored credential may send. */
export const EMAIL_ROUTE_DELEGATED = Symbol("fluxkit:email-route-delegated");

/** The stored-credential resolver. Provided by the integrations module; absent means env mode only. */
export interface ManagedEmailSource {
  emailProvider(now?: number): Promise<EmailProviderPort | undefined>;
}
export const MANAGED_EMAIL_SOURCE = Symbol("fluxkit:managed-email-source");

/** Every method of `EmailProviderPort` the API calls; a marked class that lacks one stops the startup. */
const PORT_METHODS = ["send"] as const satisfies readonly (keyof EmailProviderPort)[];

/** Read-only view of the registry for the code that sends mail. */
export interface EmailProviderSource {
  /** The active provider, `undefined` with `EMAIL_PROVIDER=none`. */
  get(code?: string): EmailProviderPort | undefined;
  /** Configured primary then fallbacks. Optional for legacy single-provider test doubles. */
  list?(): readonly EmailProviderPort[];
  /** Whether a provider is configured (`emailDelivery` of `GET /store/config` and `GET /admin/config`). */
  deliveryEnabled(): boolean;
  /**
   * Refreshes the delegated credential, if this process is allowed to use one. Callers that read `get` or
   * `deliveryEnabled` await this first. Env mode is unchanged.
   */
  prepare?(): Promise<void>;
}

function implementsPort(value: unknown): value is EmailProviderPort {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!PORT_METHODS.every((method) => typeof candidate[method] === "function")) {
    return false;
  }
  return (
    isEmailProviderCapabilities(candidate.capabilities) &&
    (candidate.webhookVerifier === undefined || typeof candidate.webhookVerifier === "function")
  );
}

/** Discovers exactly the configured ordered chain; malformed, duplicate, missing or stray providers fail startup. */
@Injectable()
export class EmailProviderRegistry implements OnApplicationBootstrap, EmailProviderSource {
  private readonly logger = new Logger(EmailProviderRegistry.name);
  private providers: readonly EmailProviderPort[] = [];
  private managed: EmailProviderPort | undefined;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(LOADED_EMAIL_PROVIDER_CODE)
    private readonly expectedCode: string | null | readonly string[],
    @Optional()
    @Inject(EMAIL_ROUTE_DELEGATED)
    private readonly delegated = false,
    @Optional()
    @Inject(MANAGED_EMAIL_SOURCE)
    private readonly runtime?: ManagedEmailSource,
  ) {}

  /** Loads the stored email credential when the route is delegated. No provider package is imported otherwise. */
  async prepare(): Promise<void> {
    if (!this.delegated || this.runtime === undefined) return;
    this.managed = await this.runtime.emailProvider();
  }

  onApplicationBootstrap(): void {
    this.discover();
    // The observable of the CI matrix (scripts/feature-matrix.sh): no route, so no new public contract.
    this.logger.log(
      `Email provider loaded: ${this.providers.map((provider) => provider.code).join(", ") || "none"}`,
    );
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
    const expected =
      this.expectedCode === null
        ? []
        : typeof this.expectedCode === "string"
          ? [this.expectedCode]
          : this.expectedCode;
    for (const code of expected) {
      if (!found.has(code))
        throw new Error(
          `Email provider "${code}" is enabled but its module contains no provider marked with EMAIL_PROVIDER_METADATA for that code.`,
        );
    }
    for (const code of found.keys()) {
      if (!expected.includes(code))
        throw new Error(
          `Email provider "${code}" was found but EMAIL_PROVIDER is ${expected.length === 0 ? "none" : `"${expected.join(", ")}"`}.`,
        );
    }
    this.providers = expected.map((code) => {
      const provider = found.get(code);
      if (provider === undefined)
        throw new Error("Email provider registry changed during discovery.");
      return provider;
    });
  }

  get(code?: string): EmailProviderPort | undefined {
    if (this.delegated) {
      if (this.managed === undefined) return undefined;
      return code === undefined || this.managed.code === code ? this.managed : undefined;
    }
    return code === undefined
      ? this.providers[0]
      : this.providers.find((provider) => provider.code === code);
  }

  list(): readonly EmailProviderPort[] {
    return this.delegated
      ? this.managed === undefined
        ? []
        : [this.managed]
      : [...this.providers];
  }

  deliveryEnabled(): boolean {
    return this.delegated ? this.managed !== undefined : this.providers.length > 0;
  }
}
