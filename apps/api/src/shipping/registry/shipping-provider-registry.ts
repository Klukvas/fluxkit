import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  SHIPPING_CAPABILITIES,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type ShippingProviderPort,
} from "@fluxkit/core";

/** Injection token: the codes of the providers that were loaded (the enabled ones); the registry must find exactly these. */
export const LOADED_SHIPPING_PROVIDER_CODES = Symbol("fluxkit:loaded-shipping-provider-codes");

/** Every method of `ShippingProviderPort` the API calls; a marked class that lacks one stops the startup. */
const PORT_METHODS = [
  "validateSettings",
  "searchCities",
  "listPickupPoints",
  "findPickupPoint",
  "estimate",
  "createWaybill",
  "findWaybill",
  "cancelWaybill",
  "track",
  "fetchLabel",
  "checkConnection",
] as const satisfies readonly (keyof ShippingProviderPort)[];

/** Read-only view of the registry for the code that calls providers. */
export interface ShippingProviderSource {
  get(code: string): ShippingProviderPort | undefined;
  list(): readonly ShippingProviderPort[];
}

function implementsPort(value: unknown): value is ShippingProviderPort {
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
    SHIPPING_CAPABILITIES.every((capability) => typeof capabilities[capability] === "boolean")
  );
}

/**
 * Finds the shipping providers once, at startup (ADR 0029 decision 8, the ADR 0018 / 0021 discovery technique): every Nest
 * provider whose class carries `SHIPPING_PROVIDER_METADATA` (`SetMetadata(SHIPPING_PROVIDER_METADATA,
 * shippingProviderMetadata(code))`). Core and this app import no provider package: the plugin marks itself and this class
 * discovers it. Startup fails loudly (never a skipped provider) when
 * - a marked class is malformed (bad code, not a static provider, missing port methods or capabilities, `code` differs
 *   from the metadata),
 * - two classes declare the same code,
 * - an enabled provider's module contributes no marked class, or a marked class belongs to a provider that is not enabled.
 */
@Injectable()
export class ShippingProviderRegistry implements OnApplicationBootstrap, ShippingProviderSource {
  private readonly logger = new Logger(ShippingProviderRegistry.name);
  private byCode = new Map<string, ShippingProviderPort>();

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(LOADED_SHIPPING_PROVIDER_CODES) private readonly expectedCodes: readonly string[],
  ) {}

  onApplicationBootstrap(): void {
    this.discover();
    // The observable of the CI provider matrix (scripts/feature-matrix.sh): no route, so no new public contract.
    const codes = this.list().map((provider) => provider.code);
    this.logger.log(`Shipping providers loaded: ${codes.length === 0 ? "none" : codes.join(",")}`);
  }

  /** Scans the providers and replaces the registry; called once at bootstrap (public so a test can assert on a fresh scan). */
  discover(): void {
    const found = new Map<string, ShippingProviderPort>();
    // `getProviders({ metadataKey })` only knows decorators made by `DiscoveryService.createDecorator`; a provider package
    // marks itself with the plain `SetMetadata`, so the class of every provider is asked for the key here.
    for (const wrapper of this.discovery.getProviders()) {
      const target: unknown = wrapper.instance?.constructor ?? wrapper.metatype;
      if (typeof target !== "function") {
        continue;
      }
      const raw: unknown = Reflect.getMetadata(SHIPPING_PROVIDER_METADATA, target);
      if (raw === undefined) {
        continue;
      }
      const name = target.name === "" ? String(wrapper.name) : target.name;
      let code: string;
      try {
        code = shippingProviderMetadata((raw as { code?: string }).code as string).code;
      } catch (error) {
        throw new Error(
          `Shipping provider ${name} declares an invalid code: ${(error as Error).message}`,
          { cause: error },
        );
      }
      const instance: unknown = wrapper.instance;
      // A request-scoped (or transient) provider has no single instance to call: its placeholder has no dependencies.
      if (!wrapper.isDependencyTreeStatic() || wrapper.isTransient || !implementsPort(instance)) {
        throw new Error(
          `Shipping provider ${name} ("${code}") must be a static provider implementing ShippingProviderPort (all methods and the capabilities).`,
        );
      }
      if (instance.code !== code) {
        throw new Error(
          `Shipping provider ${name}: its code "${String(instance.code)}" differs from the code "${code}" in its metadata.`,
        );
      }
      if (found.has(code)) {
        throw new Error(
          `Shipping provider code "${code}" is declared twice (${name} is the second).`,
        );
      }
      found.set(code, instance);
    }
    for (const expected of this.expectedCodes) {
      if (!found.has(expected)) {
        throw new Error(
          `Shipping provider "${expected}" is enabled but its module contains no provider marked with SHIPPING_PROVIDER_METADATA for that code.`,
        );
      }
    }
    for (const code of found.keys()) {
      if (!this.expectedCodes.includes(code)) {
        throw new Error(
          `Shipping provider "${code}" was found but is not enabled in SHIPPING_PROVIDERS_ENABLED.`,
        );
      }
    }
    this.byCode = found;
  }

  get(code: string): ShippingProviderPort | undefined {
    return this.byCode.get(code);
  }

  /** The loaded providers in code order. */
  list(): readonly ShippingProviderPort[] {
    return [...this.byCode.keys()]
      .sort()
      .map((code) => this.byCode.get(code))
      .filter((provider): provider is ShippingProviderPort => provider !== undefined);
  }
}
