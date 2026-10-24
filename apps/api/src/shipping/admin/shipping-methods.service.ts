import { Inject, Injectable } from "@nestjs/common";
import {
  TEXT_LIMITS,
  validateShippingPricing,
  type ShippingMethodKind,
  type ShippingPricing,
} from "@fluxkit/core";
import { i18nFieldErrors } from "../../catalog/shared/i18n-validation.js";
import { emptyToNull } from "../../catalog/shared/text.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../common/pagination.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { translatePostgresError } from "../../common/postgres-errors.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
import { toShippingMethodResponse } from "./shipping-methods.mapper.js";
import {
  ShippingMethodsRepository,
  type ShippingMethodChanges,
  type ShippingMethodRow,
} from "./shipping-methods.repository.js";
import type {
  CreateShippingMethodBody,
  ShippingMethodResponse,
  UpdateShippingMethodBody,
} from "./shipping-methods.schemas.js";

/** The fields of a method after a create or a patch, before the database sees them. */
interface MethodState {
  kind: ShippingMethodKind;
  providerCode: string | null;
  providerService: string | null;
}

@Injectable()
export class ShippingMethodsService {
  constructor(
    @Inject(ShippingMethodsRepository) private readonly methods: ShippingMethodsRepository,
    @Inject(ShippingProviderRegistry) private readonly providers: ShippingProviderRegistry,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
    @Inject(DRIZZLE) private readonly database: Database,
  ) {}

  async create(body: CreateShippingMethodBody): Promise<ShippingMethodResponse> {
    const state: MethodState = {
      kind: body.kind,
      providerCode: body.providerCode ?? null,
      providerService: body.providerService ?? null,
    };
    const errors = [
      ...this.textErrors(body),
      ...stateErrors(state),
      // A new method is checked against the enabled providers in full: nothing it names may be unknown.
      ...this.providerErrors(state),
    ];
    const pricing = this.validPricing(body.pricing, errors);
    if (errors.length > 0 || pricing === undefined) {
      throw validationFailed(errors);
    }
    try {
      const row = await this.methods.insert({
        code: body.code,
        title: body.title,
        description: emptyToNull(body.description),
        kind: state.kind,
        providerCode: state.providerCode,
        providerService: state.providerService,
        pricing,
        currency: this.pricing.shopCurrency,
        countryCodes: body.countryCodes,
        // A new method is inactive unless the admin says otherwise: activating one tightens the checkout.
        isActive: body.isActive ?? false,
        position: body.position ?? 0,
      });
      return toShippingMethodResponse(row);
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "Another shipping method already uses this code.",
      });
    }
  }

  async get(id: string): Promise<ShippingMethodResponse> {
    const row = await this.methods.findById(id);
    if (row === undefined) {
      throw notFound("Shipping method");
    }
    return toShippingMethodResponse(row);
  }

  async list(page: PaginationQuery): Promise<Page<ShippingMethodResponse>> {
    const { rows, total } = await this.methods.list(page);
    return toPage(rows.map(toShippingMethodResponse), total, page);
  }

  async update(id: string, body: UpdateShippingMethodBody): Promise<ShippingMethodResponse> {
    if (Object.keys(body).length === 0) {
      return this.get(id);
    }
    try {
      return await withTransaction(this.database, async (tx) => {
        const current = await this.methods.lockById(id, "no key update", tx);
        if (current === undefined) {
          throw notFound("Shipping method");
        }
        const { changes, errors } = this.planUpdate(current, body);
        if (errors.length > 0) {
          throw validationFailed(errors);
        }
        const row = await this.methods.update(id, changes, tx);
        if (row === undefined) {
          throw notFound("Shipping method");
        }
        return toShippingMethodResponse(row);
      });
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const current = await this.methods.lockById(id, "update", tx);
      if (current === undefined) {
        throw notFound("Shipping method");
      }
      // The row is locked: an order that places this method right now waits for this transaction, so "used" cannot change
      // between this probe and the delete. A used method stays (the snapshot keeps the order safe either way): deactivate it.
      if (await this.methods.isUsedByOrder(id, tx)) {
        throw ruleViolation(
          "An order used this shipping method. Deactivate it instead of deleting it.",
          "method_in_use",
        );
      }
      await this.methods.delete(id, tx);
    });
  }

  /** The merged state of a patch, validated; the changes are only the fields the patch names. */
  private planUpdate(
    current: ShippingMethodRow,
    body: UpdateShippingMethodBody,
  ): { changes: ShippingMethodChanges; errors: FieldError[] } {
    const state: MethodState = {
      kind: body.kind ?? (current.kind as ShippingMethodKind),
      providerCode: body.providerCode === undefined ? current.providerCode : body.providerCode,
      providerService:
        body.providerService === undefined ? current.providerService : body.providerService,
    };
    const touchesProvider =
      body.kind !== undefined ||
      body.providerCode !== undefined ||
      body.providerService !== undefined;
    const errors = [
      ...this.textErrors(body),
      ...stateErrors(state),
      // The enabled-provider check runs when the patch changes what the method points at, or switches the method on.
      // Anything else (a title, a price, switching it off) must still work after a provider was disabled.
      ...(touchesProvider || body.isActive === true ? this.providerErrors(state) : []),
    ];
    const changes: ShippingMethodChanges = {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.description === undefined ? {} : { description: emptyToNull(body.description) }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.providerCode === undefined ? {} : { providerCode: body.providerCode }),
      ...(body.providerService === undefined ? {} : { providerService: body.providerService }),
      ...(body.countryCodes === undefined ? {} : { countryCodes: body.countryCodes }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      ...(body.position === undefined ? {} : { position: body.position }),
    };
    if (body.pricing !== undefined) {
      const pricing = this.validPricing(body.pricing, errors);
      if (pricing !== undefined) {
        // New amounts are entered in the shop currency, so the method follows it.
        changes.pricing = pricing;
        changes.currency = this.pricing.shopCurrency;
      }
    }
    return { changes, errors };
  }

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private textErrors(body: { title?: unknown; description?: unknown }): FieldError[] {
    const errors: FieldError[] = [];
    if (body.title !== undefined) {
      errors.push(
        ...i18nFieldErrors("title", body.title, this.locale, {
          required: true,
          maxLength: TEXT_LIMITS.name,
        }),
      );
    }
    if (body.description !== undefined && body.description !== null) {
      errors.push(
        ...i18nFieldErrors("description", body.description, this.locale, {
          required: false,
          maxLength: TEXT_LIMITS.description,
        }),
      );
    }
    return errors;
  }

  /** Core's pricing rules; its reasons become `errors[].code` at `pricing.<field>`. */
  private validPricing(value: unknown, errors: FieldError[]): ShippingPricing | undefined {
    const result = validateShippingPricing(value);
    if (result.ok) {
      return result.pricing;
    }
    for (const error of result.errors) {
      errors.push({
        path: error.field === "" ? "pricing" : `pricing.${error.field}`,
        code: error.reason,
      });
    }
    return undefined;
  }

  /** The provider a method names must be one the shop runs (`SHIPPING_PROVIDERS_ENABLED`), and a pickup point needs one that lists points. */
  private providerErrors(state: MethodState): FieldError[] {
    if (state.providerCode === null) {
      return [];
    }
    const provider = this.providers.get(state.providerCode);
    if (provider === undefined) {
      return [{ path: "providerCode", code: "provider_not_enabled" }];
    }
    if (state.kind === "pickup_point" && !provider.capabilities.pickupPoints) {
      return [{ path: "kind", code: "provider_lacks_pickup_points" }];
    }
    return [];
  }
}

/** The combinations the database refuses (CHECK constraints), reported as field errors before the insert. */
function stateErrors(state: MethodState): FieldError[] {
  const errors: FieldError[] = [];
  if (state.kind === "pickup_point" && state.providerCode === null) {
    errors.push({ path: "providerCode", code: "provider_required" });
  }
  if (state.providerService !== null && state.providerCode === null) {
    errors.push({ path: "providerService", code: "provider_required" });
  }
  return errors;
}
