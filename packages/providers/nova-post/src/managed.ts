import { Logger } from "@nestjs/common";
import type { CreateOutboundClient, CheckCredentials } from "@fluxkit/core";
import { parseNovaPostEnv } from "./config.js";
import { NovaPostHttp } from "./http.js";
import { NovaPostShippingProvider } from "./nova-post-provider.js";

/** One HTTP/JWT cache per immutable credential version and environment. Construction does no I/O. */
export const createOutboundClient: CreateOutboundClient<"shipping"> = (secrets, context) => {
  if (!["sandbox", "production"].includes(context.environment))
    throw new Error("credential_unavailable");
  const config = parseNovaPostEnv({
    NOVA_POST_API_KEY: secrets.api_key,
    NOVA_POST_ENVIRONMENT: context.environment,
  });
  const logger = new Logger("NovaPost");
  return new NovaPostShippingProvider(
    new NovaPostHttp({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      logger,
      now: () => context.now().getTime(),
      transport: context.transport,
    }),
    logger,
  );
};
export const checkCredentials: CheckCredentials = async (secrets, context, signal) => {
  const result = await createOutboundClient(secrets, context).checkConnection(signal);
  if (result.ok) return { code: "ok" };
  return {
    code: result.providerCodes.includes("429")
      ? "rate_limited"
      : result.reason === "invalid_credentials"
        ? "invalid_credentials"
        : result.reason === "not_supported"
          ? "not_supported"
          : "unavailable",
  };
};
