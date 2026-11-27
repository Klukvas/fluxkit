import { Module, SetMetadata } from "@nestjs/common";
import {
  providerFailure,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type CheckCredentials,
  type CreateOutboundClient,
  type ProviderAbortSignal,
  type ProviderResult,
} from "@fluxkit/core";
import { TestShippingProvider, type TestOperation } from "./test-shipping-provider.js";
import type { LoadedShippingProvider } from "../shipping/registry/index.js";

export interface ManagedShippingRequest {
  readonly operation: TestOperation | "authorization" | "checkConnection";
  readonly key: string;
  readonly environment: string;
  readonly numbers: readonly string[];
}

/** TEST ONLY: shared remote state; each immutable client has its own simulated token and transport gate. */
export class ManagedTestShippingProvider {
  readonly backend = new TestShippingProvider();
  readonly calls: ManagedShippingRequest[] = [];
  readonly estimateAmounts = new Map<string, number>();
  onRequest?: (call: ManagedShippingRequest, input?: unknown) => Promise<void>;
  constructor(readonly code = "testship") {}

  readonly createOutboundClient: CreateOutboundClient<"shipping"> = (secrets, context) => {
    const key = secrets.api_key;
    if (!key) throw new Error("incomplete_bundle");
    let token: Promise<void> | undefined;
    const start = <T>(
      operation: ManagedShippingRequest["operation"],
      signal: ProviderAbortSignal,
      work: () => Promise<T>,
      input?: unknown,
    ): Promise<T> =>
      context.transport.start(signal, () => {
        const call: ManagedShippingRequest = {
          operation,
          key,
          environment: context.environment,
          numbers:
            operation === "track"
              ? (input as { trackingNumbers: readonly string[] }).trackingNumbers
              : [],
        };
        this.calls.push(call);
        const observed = this.onRequest?.(call, input);
        return { completion: Promise.resolve(observed).then(work) };
      });
    const request = async <T>(
      operation: ManagedShippingRequest["operation"],
      signal: ProviderAbortSignal,
      work: () => Promise<T>,
      input?: unknown,
    ): Promise<T> => {
      try {
        token ??= start("authorization", signal, async () => undefined);
        await token;
        return await start(operation, signal, work, input);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "CredentialAdmissionDenied" &&
          "code" in error
        ) {
          throw Object.assign(new Error("credential_admission_denied"), { codes: [error.code] });
        }
        throw error;
      }
    };
    const result = async <T>(
      work: () => Promise<ProviderResult<T>>,
    ): Promise<ProviderResult<T>> => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof Error && "codes" in error && Array.isArray(error.codes))
          return providerFailure("unavailable", error.codes as string[]);
        throw error;
      }
    };
    return {
      code: this.code,
      capabilities: this.backend.capabilities,
      validateSettings: (settings) => this.backend.validateSettings(settings),
      searchCities: (input, signal) =>
        request("searchCities", signal, () => this.backend.searchCities(input, signal), input),
      listPickupPoints: (input, signal) =>
        request(
          "listPickupPoints",
          signal,
          () => this.backend.listPickupPoints(input, signal),
          input,
        ),
      findPickupPoint: (input, signal) =>
        request(
          "findPickupPoint",
          signal,
          () => this.backend.findPickupPoint(input, signal),
          input,
        ),
      estimate: (input, signal) =>
        result(() =>
          request(
            "estimate",
            signal,
            async () => {
              const answer = await this.backend.estimate(input, signal);
              return answer.ok
                ? {
                    ...answer,
                    value: {
                      ...answer.value,
                      amount: this.estimateAmounts.get(key) ?? answer.value.amount,
                    },
                  }
                : answer;
            },
            input,
          ),
        ),
      createWaybill: (input, signal) =>
        result(() =>
          request("createWaybill", signal, () => this.backend.createWaybill(input, signal), input),
        ),
      findWaybill: (input, signal) =>
        result(() =>
          request("findWaybill", signal, () => this.backend.findWaybill(input, signal), input),
        ),
      cancelWaybill: (input, signal) =>
        result(() =>
          request("cancelWaybill", signal, () => this.backend.cancelWaybill(input, signal), input),
        ),
      track: (input, signal) =>
        result(() => request("track", signal, () => this.backend.track(input, signal), input)),
      fetchLabel: (input, signal) =>
        result(() =>
          request("fetchLabel", signal, () => this.backend.fetchLabel(input, signal), input),
        ),
      checkConnection: (signal) =>
        result(() =>
          request("checkConnection", signal, () => this.backend.checkConnection(signal)),
        ),
    };
  };

  readonly checkCredentials: CheckCredentials = async (secrets, context, signal) => {
    const checked = await this.createOutboundClient(secrets, context).checkConnection(signal);
    return { code: checked.ok ? "ok" : "unavailable" };
  };

  /** An env-mode stand-in over the same simulated remote state, without any installed package or process env. */
  envProviders(): LoadedShippingProvider[] {
    @SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(this.code))
    class EnvShipping {}
    const port = this.createOutboundClient(
      { api_key: "invented-env-shipping-key" },
      {
        kind: "shipping",
        providerCode: this.code,
        versionId: "env",
        environment: "sandbox",
        now: () => new Date(),
        transport: {
          start: async (signal, begin) => {
            signal.throwIfAborted();
            return begin().completion;
          },
        },
      },
    );
    @Module({
      providers: [{ provide: EnvShipping, useValue: Object.assign(new EnvShipping(), port) }],
    })
    class EnvShippingModule {}
    return [{ code: this.code, module: EnvShippingModule }];
  }
}
