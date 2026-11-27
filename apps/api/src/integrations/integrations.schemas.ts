import {
  INTEGRATION_KINDS,
  INTEGRATION_SECRET_FIELD_PATTERN,
  INTEGRATION_SECRET_MAX_BYTES,
  INTEGRATION_SECRET_PURPOSES,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

export const INTEGRATION_SECRET_STATES = ["not_set", "set", "env"] as const;
/** States a listed secret can be in. `retired` is omitted: a retired version has no envelope and is not listed. */
export const LISTED_CREDENTIAL_STATES = ["candidate", "active", "draining", "revoked"] as const;
export const INTEGRATION_STORAGE_STATES = ["ready", "disabled"] as const;

const CURRENT_PASSWORD_MAX_LENGTH = 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const expectedRevision = z.number().int().min(0).meta({
  description:
    "The `revision` of the last read. Another change since then answers 409 (`rule: integration_revision_stale`).",
});

// writeOnly, no example, no default: the document must never suggest that a secret can be read back.
const currentPassword = z.string().min(1).max(CURRENT_PASSWORD_MAX_LENGTH).meta({
  writeOnly: true,
  format: "password",
  description: "The signed-in owner's current password, asked again for every change.",
});

export const putIntegrationSecretSchema = z.strictObject({
  expectedRevision,
  environment: z.string().regex(INTEGRATION_SECRET_FIELD_PATTERN).optional(),
  value: z.string().min(1).max(INTEGRATION_SECRET_MAX_BYTES).meta({
    writeOnly: true,
    format: "password",
    description:
      "The credential as the provider shows it: printable ASCII without spaces. Stored encrypted; never returned.",
  }),
  currentPassword,
});
export type PutIntegrationSecretBody = z.infer<typeof putIntegrationSecretSchema>;

export const retireIntegrationSecretSchema = z.strictObject({
  expectedRevision,
  versionId: z.string().regex(UUID_PATTERN, "Not a version id.").meta({ format: "uuid" }),
  currentPassword,
});
export type RetireIntegrationSecretBody = z.infer<typeof retireIntegrationSecretSchema>;

export const integrationMutationSchema = z.strictObject({
  expectedRevision,
  currentPassword,
});
export type IntegrationMutationBody = z.infer<typeof integrationMutationSchema>;

export const EMAIL_ROUTE_MODES = ["equal", "resend"] as const;

export const setEmailRouteSchema = z.strictObject({
  mode: z.enum(EMAIL_ROUTE_MODES).meta({
    description:
      "`equal`: new mail alternates between Resend and Brevo. `resend`: every new message starts with Resend. A definite non-acceptance is tried on the other. A chain that contains both follows this, including a chain set on the server. A timeout or a rejected message stays on the provider that saw it.",
  }),
  expectedRevision,
  currentPassword,
});
export type SetEmailRouteBody = z.infer<typeof setEmailRouteSchema>;

export const integrationSecretSchema = z.object({
  field: z.string(),
  purpose: z.enum(INTEGRATION_SECRET_PURPOSES),
  envVariable: z.string().meta({
    description: "The server variable that overrides the stored value when it is set.",
  }),
  state: z.enum(INTEGRATION_SECRET_STATES).meta({
    description:
      "`env`: set on the server, read-only here. `set`: a value is stored. `not_set`: neither. The value itself is never returned.",
  }),
  last4: z.null().meta({ description: "Always null: no part of a secret is ever returned." }),
  versionId: uuidSchema.nullable().meta({
    description: "The stored credential version, for `retire-secret`; null when nothing is stored.",
  }),
  generation: z.number().int().nullable(),
  savedAt: timestampSchema.nullable(),
  keyAvailable: z.boolean().nullable().meta({
    description:
      "Whether this server holds the master key that sealed the stored value; false means it must be entered again. Null when nothing is stored.",
  }),
  versionState: z.enum(LISTED_CREDENTIAL_STATES).nullable().meta({
    description:
      "`candidate`: saved, not used. `active`: new mail uses it. `draining`: turned off, mail already bound to it can finish. `revoked`: unusable. Null when nothing is stored.",
  }),
});

export const integrationVersionSchema = z.object({
  id: uuidSchema,
  purpose: z.enum(INTEGRATION_SECRET_PURPOSES),
  generation: z.number().int().min(1),
  state: z.enum(LISTED_CREDENTIAL_STATES),
  environment: z.string().regex(INTEGRATION_SECRET_FIELD_PATTERN),
  createdAt: timestampSchema,
  fields: z.array(z.string()),
});
export type IntegrationVersionResponse = z.infer<typeof integrationVersionSchema>;
export const checkIntegrationSchema = z.strictObject({ expectedRevision, versionId: uuidSchema });
export type CheckIntegrationBody = z.infer<typeof checkIntegrationSchema>;
export const integrationCheckResponseSchema = z.object({
  versionId: uuidSchema,
  code: z.enum(["ok", "invalid_credentials", "unavailable", "rate_limited", "not_supported"]),
  checkedAt: timestampSchema,
  retryAfterSeconds: z.number().int().min(0).max(86400).optional(),
});
export type IntegrationCheckResponse = z.infer<typeof integrationCheckResponseSchema>;

export const integrationSchema = z.object({
  id: uuidSchema,
  kind: z.enum(INTEGRATION_KINDS),
  providerCode: z.string(),
  enabled: z.boolean().meta({
    description:
      "True when new mail uses the stored outbound credential. Payment and shipping stay false until their safety checks exist.",
  }),
  secrets: z.array(integrationSecretSchema),
  versions: z.array(integrationVersionSchema).max(20),
  environmentSource: z.enum(["env", "store"]),
  environment: z.string().regex(INTEGRATION_SECRET_FIELD_PATTERN),
  environments: z
    .object({
      values: z.array(z.string()).min(1).max(8),
      default: z.string(),
      envVariable: z.string(),
    })
    .optional(),
  updatedAt: timestampSchema,
});
export type IntegrationResponse = z.infer<typeof integrationSchema>;

const revision = z.number().int().meta({
  description: "Rises with every integration change; send it back as `expectedRevision`.",
});
const storage = z.enum(INTEGRATION_STORAGE_STATES).meta({
  description:
    "`disabled`: `SECRETS_ENCRYPTION_KEY` is not set on the server, so nothing can be saved here.",
});

const emailRouteMode = z.enum(EMAIL_ROUTE_MODES).meta({
  description:
    "How Resend and Brevo share mail when both are in the send chain. `equal` alternates. `resend` starts every message with Resend. A chain with only one of them is unchanged.",
});

export const integrationListResponseSchema = z.object({
  revision,
  storage,
  emailRouteMode,
  items: z.array(integrationSchema),
});
export type IntegrationListResponse = z.infer<typeof integrationListResponseSchema>;

export const emailRouteResponseSchema = z.object({
  revision,
  emailRouteMode,
});
export type EmailRouteResponse = z.infer<typeof emailRouteResponseSchema>;

export const integrationDetailResponseSchema = z.object({
  revision,
  storage,
  integration: integrationSchema,
});
export type IntegrationDetailResponse = z.infer<typeof integrationDetailResponseSchema>;
