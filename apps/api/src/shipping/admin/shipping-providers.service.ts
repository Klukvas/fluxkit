import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isProviderSettingsIssueList,
  SHIPPING_PROVIDER_CODE_PATTERN,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  type ProviderSettingsIssue,
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
    const provider = this.provider(code);
    // The bounded check every provider gets first, then the provider's own rules (plan step 7b).
    const generic = providerSettingsErrors(settings);
    const errors = (generic.length > 0 ? generic : this.providerIssues(provider, settings)).map(
      (error) => ({
        path: error.path === "" ? "settings" : `settings.${error.path}`,
        code: error.code,
      }),
    );
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

  /**
   * The provider's own verdict on the settings (`validateSettings`). An answer that breaks the port (not a list of short
   * codes and plain paths) or a throw is a bug in the provider: it is logged by class name only (a provider's text could
   * echo a value) and answered as a 500, never as a validation result the admin would trust.
   */
  private providerIssues(
    provider: ShippingProviderPort,
    settings: Record<string, unknown>,
  ): readonly ProviderSettingsIssue[] {
    let issues: unknown;
    // The thrown error is not attached as a cause: its message is the provider's text, which may echo a value.
    let thrown: string | undefined;
    try {
      issues = provider.validateSettings(settings);
    } catch (error) {
      thrown = error instanceof Error ? error.constructor.name : typeof error;
    }
    if (thrown !== undefined) {
      this.logger.error(`Shipping provider "${provider.code}" validateSettings threw ${thrown}`);
      throw new Error(`Shipping provider "${provider.code}" validateSettings failed (${thrown})`);
    }
    if (!isProviderSettingsIssueList(issues)) {
      this.logger.error(
        `Shipping provider "${provider.code}" validateSettings answered something that breaks the port`,
      );
      throw new Error(`Shipping provider "${provider.code}" validateSettings broke the port`);
    }
    return issues;
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
