import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  providerFailure,
  providerOk,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type ProviderAbortSignal,
  type ProviderFailureReason,
  type ProviderResult,
  type ShippingProviderPort,
} from "@fluxkit/core";
import type { LoadedShippingProvider } from "../shipping/registry/index.js";

/** Code of the in-repo test provider. Specs mount it with `startApp({ extraShippingProviders: testShippingProviders() })`. */
export const TEST_PROVIDER_CODE = "fake";

export interface TestProviderFailure {
  reason?: ProviderFailureReason;
  providerCodes?: readonly string[];
  /** The call never answers until its abort signal fires, then rejects (a timeout). */
  hang?: boolean;
}

const unused = (): never => {
  throw new Error("The test shipping provider only implements checkConnection");
};

/**
 * TEST ONLY. A small provider that lives in apps/api, so core and API specs depend on no package under packages/providers
 * (the CI mode providers-deleted removes them). Only `checkConnection` does anything, and a spec can plan its failures with
 * `failNext`; the other port methods throw, so a spec that starts using them has to say what they should answer first.
 */
@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(TEST_PROVIDER_CODE))
export class TestShippingProvider implements ShippingProviderPort {
  readonly code = TEST_PROVIDER_CODE;
  readonly capabilities = Object.freeze({
    pickupPoints: true,
    estimate: false,
    waybills: false,
    cancelWaybill: false,
    tracking: false,
    labels: false,
  });
  private pending: (TestProviderFailure & { remaining: number }) | undefined;

  searchCities = unused;
  listPickupPoints = unused;
  estimate = unused;
  createWaybill = unused;
  findWaybill = unused;
  cancelWaybill = unused;
  track = unused;
  fetchLabel = unused;

  failNext(failure: TestProviderFailure = {}): void {
    this.pending = { ...failure, remaining: 1 };
  }

  reset(): void {
    this.pending = undefined;
  }

  checkConnection(signal: ProviderAbortSignal): Promise<ProviderResult<void>> {
    const failure = this.pending;
    this.pending = undefined;
    if (failure === undefined) {
      return Promise.resolve(providerOk(undefined));
    }
    if (failure.hang === true) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }
    return Promise.resolve(
      providerFailure(failure.reason ?? "unavailable", failure.providerCodes ?? []),
    );
  }
}

@Module({ providers: [TestShippingProvider], exports: [TestShippingProvider] })
class TestShippingProviderModule {}

export function testShippingProviders(): LoadedShippingProvider[] {
  return [{ code: TEST_PROVIDER_CODE, module: TestShippingProviderModule as Type<unknown> }];
}
