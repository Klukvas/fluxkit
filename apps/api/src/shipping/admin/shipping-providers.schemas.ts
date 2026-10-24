import { PROVIDER_FAILURE_REASONS } from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { PROVIDER_SETTINGS_LIMITS } from "./provider-settings.js";

/** `PUT /admin/shipping/providers/:code/settings`: the whole settings object replaces the stored one. */
/**
 * A custom check, not `z.record`: zod rebuilds a record and silently drops an own `__proto__` key, so a hostile key would
 * pass unseen. Here the parsed value reaches `providerSettingsErrors` untouched and its key rules refuse it.
 */
const settingsInputSchema = z
  .custom<Record<string, unknown>>(
    (value) => typeof value === "object" && value !== null && !Array.isArray(value),
    { message: "Must be a JSON object.", params: { code: "invalid_type" } },
  )
  .meta({
    type: "object",
    additionalProperties: {},
    description: `Non-secret settings of the provider (sender data, default parcel). A plain JSON object: at most ${String(PROVIDER_SETTINGS_LIMITS.maxBytes)} bytes, ${String(PROVIDER_SETTINGS_LIMITS.maxDepth)} levels deep, ${String(PROVIDER_SETTINGS_LIMITS.maxKeysPerObject)} keys per object, keys of letters, digits and _ , and no key that names a credential (API keys live in the environment, never here).`,
  });

/** `PUT /admin/shipping/providers/:code/settings`: the whole settings object replaces the stored one. */
export const putProviderSettingsSchema = z.strictObject({ settings: settingsInputSchema });

export const providerSettingsResponseSchema = z.object({
  providerCode: z.string(),
  settings: z.record(z.string(), z.unknown()),
  updatedAt: timestampSchema.nullable(),
  updatedBy: uuidSchema.nullable(),
});

/** The typed answer of a connection check: carrier reason and codes only, never message text or secrets. */
export const providerCheckResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(PROVIDER_FAILURE_REASONS),
    providerCodes: z.array(z.string()).meta({
      description: "Raw carrier codes (short, no spaces); may be empty.",
    }),
  }),
]);

export type PutProviderSettingsBody = z.output<typeof putProviderSettingsSchema>;
export type ProviderSettingsResponse = z.output<typeof providerSettingsResponseSchema>;
export type ProviderCheckResponse = z.output<typeof providerCheckResponseSchema>;
