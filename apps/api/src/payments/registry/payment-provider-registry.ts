import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  PAYMENT_PROVIDER_METADATA,
  paymentProviderMetadata,
  type PaymentProviderPort,
} from "@fluxkit/core";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";

/** Injection token: the codes of the providers that were loaded (the enabled ones); the registry must find exactly these. */
export const LOADED_PAYMENT_PROVIDER_CODES = Symbol("fluxkit:loaded-payment-provider-codes");

/** Every method of `PaymentProviderPort` the API calls; a marked class that lacks one stops the startup. */
const PORT_METHODS = [
  "createPayment",
  "getPayment",
  "invalidatePayment",
  "refund",
  "verifyWebhook",
] as const satisfies readonly (keyof PaymentProviderPort)[];

const CAPABILITY_FLAGS = [
  "partialRefunds",
  "multipleRefunds",
  "invalidateUnpaid",
  "webhooks",
] as const;

/** Read-only view of the registry for the code that calls providers. */
export interface PaymentProviderSource {
  get(code: string): PaymentProviderPort | undefined;
  /** The loaded providers in code order. */
  list(): readonly PaymentProviderPort[];
  /** Whether any provider is enabled (`onlinePayment` of `GET /store/config` and `GET /admin/config`). */
  onlineEnabled(): boolean;
}

function implementsPort(value: unknown): value is PaymentProviderPort {
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
    Array.isArray(capabilities.currencies) &&
    capabilities.currencies.length > 0 &&
    capabilities.currencies.every((code: unknown) => typeof code === "string") &&
    CAPABILITY_FLAGS.every((flag) => typeof capabilities[flag] === "boolean")
  );
}

/**
 * Finds the payment providers once, at startup (ADR 0032 decision 3; the technique of `ShippingProviderRegistry`): every
 * Nest provider whose class carries `PAYMENT_PROVIDER_METADATA` (`SetMetadata(PAYMENT_PROVIDER_METADATA,
 * paymentProviderMetadata(code))`). Core and this app import no provider package. Startup fails loudly (never a skipped
 * provider) when
 * - a marked class is malformed (bad code, not a static provider, missing port methods or capabilities, `code` differs
 *   from the metadata),
 * - two classes declare the same code,
 * - an enabled provider's module contributes no marked class, or a marked class belongs to a provider that is not enabled,
 * - an enabled provider does not take `SHOP_CURRENCY` (`capabilities.currencies`).
 * With no provider enabled the list is empty and online payment is off: the shop works as before (manual mark paid).
 */
@Injectable()
export class PaymentProviderRegistry implements OnApplicationBootstrap, PaymentProviderSource {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private byCode = new Map<string, PaymentProviderPort>();

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(LOADED_PAYMENT_PROVIDER_CODES) private readonly expectedCodes: readonly string[],
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.discover();
    // The observable of the CI provider matrix (scripts/feature-matrix.sh): no route, so no new public contract.
    const codes = this.list().map((provider) => provider.code);
    this.logger.log(`Payment providers loaded: ${codes.length === 0 ? "none" : codes.join(",")}`);
  }

  /** Scans the providers and replaces the registry; called once at bootstrap (public so a test can assert on a fresh scan). */
  discover(): void {
    const found = new Map<string, PaymentProviderPort>();
    // `getProviders({ metadataKey })` only knows decorators made by `DiscoveryService.createDecorator`; a provider package
    // marks itself with the plain `SetMetadata`, so the class of every provider is asked for the key here.
    for (const wrapper of this.discovery.getProviders()) {
      const target: unknown = wrapper.instance?.constructor ?? wrapper.metatype;
      if (typeof target !== "function") {
        continue;
      }
      const raw: unknown = Reflect.getMetadata(PAYMENT_PROVIDER_METADATA, target);
      if (raw === undefined) {
        continue;
      }
      const name = target.name === "" ? String(wrapper.name) : target.name;
      let code: string;
      try {
        code = paymentProviderMetadata((raw as { code?: string }).code as string).code;
      } catch (error) {
        throw new Error(
          `Payment provider ${name} declares an invalid code: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const instance: unknown = wrapper.instance;
      // A request-scoped (or transient) provider has no single instance to call: its placeholder has no dependencies.
      if (!wrapper.isDependencyTreeStatic() || wrapper.isTransient || !implementsPort(instance)) {
        throw new Error(
          `Payment provider ${name} ("${code}") must be a static provider implementing PaymentProviderPort (all methods and the capabilities).`,
        );
      }
      if (instance.code !== code) {
        throw new Error(
          `Payment provider ${name}: its code "${String(instance.code)}" differs from the code "${code}" in its metadata.`,
        );
      }
      if (found.has(code)) {
        throw new Error(
          `Payment provider code "${code}" is declared twice (${name} is the second).`,
        );
      }
      found.set(code, instance);
    }
    for (const expected of this.expectedCodes) {
      if (!found.has(expected)) {
        throw new Error(
          `Payment provider "${expected}" is enabled but its module contains no provider marked with PAYMENT_PROVIDER_METADATA for that code.`,
        );
      }
    }
    for (const code of found.keys()) {
      if (!this.expectedCodes.includes(code)) {
        throw new Error(
          `Payment provider "${code}" was found but is not enabled in PAYMENT_PROVIDERS_ENABLED.`,
        );
      }
    }
    for (const [code, provider] of found) {
      if (!provider.capabilities.currencies.includes(this.pricing.shopCurrency)) {
        throw new Error(
          `Payment provider "${code}" does not take the shop currency ${this.pricing.shopCurrency} (SHOP_CURRENCY); it takes ${provider.capabilities.currencies.join(", ")}.`,
        );
      }
    }
    this.byCode = found;
  }

  get(code: string): PaymentProviderPort | undefined {
    return this.byCode.get(code);
  }

  list(): readonly PaymentProviderPort[] {
    return [...this.byCode.keys()]
      .sort()
      .map((code) => this.byCode.get(code))
      .filter((provider): provider is PaymentProviderPort => provider !== undefined);
  }

  onlineEnabled(): boolean {
    return this.byCode.size > 0;
  }
}
