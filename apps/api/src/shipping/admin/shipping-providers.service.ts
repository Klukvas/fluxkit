import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  SHIPPING_PROVIDER_CODE_PATTERN,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  type ShippingProviderPort,
} from "@fluxkit/core";
import { translatePostgresError } from "../../common/postgres-errors.js";
import { notFound, validationFailed } from "../../common/problem.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
import { callProvider, describeOutcome } from "../shipments/provider-call.js";
import { providerSettingsErrors } from "./provider-settings.js";
import {
  ShippingProviderSettingsRepository,
  type ProviderSettingRow,
} from "./shipping-provider-settings.repository.js";
import type {
  ProviderCheckResponse,
  ProviderSettingsResponse,
} from "./shipping-providers.schemas.js";

@Injectable()
export class ShippingProvidersService {
  private readonly logger = new Logger("ShippingProviders");

  constructor(
    @Inject(ShippingProviderRegistry) private readonly providers: ShippingProviderRegistry,
    @Inject(ShippingProviderSettingsRepository)
    private readonly settings: ShippingProviderSettingsRepository,
  ) {}

  async getSettings(code: string): Promise<ProviderSettingsResponse> {
    this.provider(code);
    return toResponse(code, await this.settings.find(code));
  }

  async putSettings(
    code: string,
    settings: Record<string, unknown>,
    adminUserId: string,
  ): Promise<ProviderSettingsResponse> {
    this.provider(code);
    const errors = providerSettingsErrors(settings).map((error) => ({
      path: error.path === "" ? "settings" : `settings.${error.path}`,
      code: error.code,
    }));
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    try {
      return toResponse(code, await this.settings.upsert(code, settings, adminUserId));
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  /**
   * Asks the provider whether the shop's credentials work. The answer is the provider's typed reason and carrier codes,
   * nothing else: no message text, no key. The call goes through `callProvider` like every other provider call (review
   * m-1): the API's time limit (ADR 0029 decision 9) is enforced even when the provider ignores the abort signal, and a
   * timeout, a throw or an answer that breaks the port (a message passed off as a code) is `unavailable`, logged with the
   * outcome kind and the error's class name only.
   */
  async check(code: string): Promise<ProviderCheckResponse> {
    const provider = this.provider(code);
    const outcome = await callProvider(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup, (signal) =>
      provider.checkConnection(signal),
    );
    if (outcome.kind === "ok") {
      return { ok: true };
    }
    if (outcome.kind === "failed") {
      return { ok: false, reason: outcome.reason, providerCodes: [...outcome.providerCodes] };
    }
    this.logger.warn(
      `Shipping provider "${provider.code}" checkConnection: ${describeOutcome(outcome)}`,
    );
    return { ok: false, reason: "unavailable", providerCodes: [] };
  }

  /** A provider the shop runs, or 404. A code that is not even a code is the controller's 400. */
  private provider(code: string): ShippingProviderPort {
    const provider = SHIPPING_PROVIDER_CODE_PATTERN.test(code)
      ? this.providers.get(code)
      : undefined;
    if (provider === undefined) {
      throw notFound("Shipping provider");
    }
    return provider;
  }
}

function toResponse(code: string, row: ProviderSettingRow | undefined): ProviderSettingsResponse {
  return {
    providerCode: code,
    settings: (row?.settings ?? {}) as Record<string, unknown>,
    updatedAt: row === undefined ? null : row.updatedAt.toISOString(),
    updatedBy: row?.updatedBy ?? null,
  };
}
