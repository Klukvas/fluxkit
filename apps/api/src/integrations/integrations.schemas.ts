import {
  INTEGRATION_KINDS,
  INTEGRATION_SECRET_MAX_BYTES,
  INTEGRATION_SECRET_PURPOSES,
} from "@fluxkit/core";
import { z } from "zod";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

export const INTEGRATION_SECRET_STATES = ["not_set", "set", "env"] as const;
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
});

export const integrationSchema = z.object({
  id: uuidSchema,
  kind: z.enum(INTEGRATION_KINDS),
  providerCode: z.string(),
  secrets: z.array(integrationSecretSchema),
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

export const integrationListResponseSchema = z.object({
  revision,
  storage,
  items: z.array(integrationSchema),
});
export type IntegrationListResponse = z.infer<typeof integrationListResponseSchema>;

export const integrationDetailResponseSchema = z.object({
  revision,
  storage,
  integration: integrationSchema,
});
export type IntegrationDetailResponse = z.infer<typeof integrationDetailResponseSchema>;
