import { Inject, Injectable } from "@nestjs/common";
import {
  providerFailure,
  SHIPPING_PROVIDER_CODE_PATTERN,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  type ShippingProviderPort,
} from "@fluxkit/core";
import { translatePostgresError } from "../../common/postgres-errors.js";
import { notFound, validationFailed } from "../../common/problem.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
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
   * nothing else: no message text, no key. The API sets the time limit (ADR 0029 decision 9); a call that runs out of time
   * is `unavailable`. Any other throw is a provider bug and surfaces as a logged 500.
   */
  async check(code: string): Promise<ProviderCheckResponse> {
    const provider = this.provider(code);
    const signal = AbortSignal.timeout(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
    let result: Awaited<ReturnType<ShippingProviderPort["checkConnection"]>>;
    try {
      result = await provider.checkConnection(signal);
    } catch (error) {
      if (signal.aborted) {
        return { ok: false, reason: "unavailable", providerCodes: [] };
      }
      throw error;
    }
    if (result.ok) {
      return { ok: true };
    }
    // Re-checks reason and codes (a RangeError for a message passed as a code): a plugin cannot smuggle text through.
    const checked = providerFailure(result.reason, result.providerCodes);
    if (checked.ok) {
      throw new Error("providerFailure returned a success");
    }
    return { ok: false, reason: checked.reason, providerCodes: [...checked.providerCodes] };
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
