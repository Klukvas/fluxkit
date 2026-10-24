import { Inject, Injectable } from "@nestjs/common";
import { PICKUP_POINT_KINDS, type ShippingProviderPort } from "@fluxkit/core";
import { StoreService } from "../../catalog/store/store.service.js";
import { notFound, shippingProviderUnavailable } from "../../common/problem.js";
import {
  ShippingDirectoryService,
  ShippingProviderUnavailableError,
} from "./shipping-directory.service.js";
import { SHIPPING_STORE_LIMITS } from "./shipping-store-limits.js";
import type {
  ShippingCitiesQuery,
  ShippingCityPage,
  ShippingPickupPointPage,
  ShippingPickupPointsQuery,
} from "./shipping-store.schemas.js";

/**
 * `GET /store/shipping/providers/{code}/cities` and `.../pickup-points` (ADR 0029 decision 5): pages cut from the cached
 * directory. An unknown or disabled provider, or one without pickup points for the points route, is `404`; a carrier that
 * cannot be reached with nothing usable cached is `503 shipping_provider_unavailable` with `Retry-After`.
 */
@Injectable()
export class ShippingLookupService {
  constructor(
    @Inject(ShippingDirectoryService) private readonly directory: ShippingDirectoryService,
    @Inject(StoreService) private readonly store: StoreService,
  ) {}

  async cities(code: string, query: ShippingCitiesQuery): Promise<ShippingCityPage> {
    const provider = this.provider(code);
    const locale = this.store.resolveLocale(query.locale);
    const page = await this.unavailableAs503(() =>
      this.directory.searchCities(provider, query.q, locale.locale),
    );
    return {
      items: page.items.slice(query.offset, query.offset + query.limit).map((city) => ({
        ref: city.ref,
        name: city.name,
        region: city.region,
      })),
      total: page.items.length,
      limit: query.limit,
      offset: query.offset,
      stale: page.stale,
    };
  }

  async pickupPoints(
    code: string,
    query: ShippingPickupPointsQuery,
  ): Promise<ShippingPickupPointPage> {
    const provider = this.provider(code);
    if (!provider.capabilities.pickupPoints) {
      throw notFound("Shipping provider");
    }
    const page = await this.unavailableAs503(() =>
      this.directory.listPickupPoints(provider, query.cityRef),
    );
    const kinds = query.kinds ?? PICKUP_POINT_KINDS;
    const needle = (query.q ?? "").toLowerCase();
    const matching = page.items.filter(
      (point) =>
        kinds.includes(point.kind) &&
        (needle === "" ||
          point.number.toLowerCase().includes(needle) ||
          point.description.toLowerCase().includes(needle)),
    );
    return {
      items: matching.slice(query.offset, query.offset + query.limit).map((point) => ({
        ref: point.ref,
        number: point.number,
        kind: point.kind,
        cityRef: point.cityRef,
        cityName: point.cityName,
        countryCode: point.countryCode,
        description: point.description,
        maxWeightGrams: point.maxWeightGrams,
      })),
      total: matching.length,
      limit: query.limit,
      offset: query.offset,
      stale: page.stale,
    };
  }

  private provider(code: string): ShippingProviderPort {
    const provider = this.directory.provider(code);
    if (provider === undefined) {
      throw notFound("Shipping provider");
    }
    return provider;
  }

  private async unavailableAs503<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ShippingProviderUnavailableError) {
        throw shippingProviderUnavailable(SHIPPING_STORE_LIMITS.retryAfterSeconds);
      }
      throw error;
    }
  }
}
