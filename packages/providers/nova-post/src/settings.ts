import { z } from "zod";
import { CARRIER_CODE_PATTERN, type ProviderSettingsIssue } from "@fluxkit/core";

/*
 * The shop's sender profile for Nova Post (`shipping_provider_setting.settings`, non-secret; shipping plan section 8.4,
 * plan step 7b). The create and the calculation take the sender inline (name, phone, optional email and company, the
 * division where parcels are handed in), so nothing has to be created in the carrier's cabinet. The key is NOT here: it
 * lives in the environment (`NOVA_POST_API_KEY`).
 */

/** A Ukrainian phone as the API takes it (E.164 digits without `+`), e.g. `380501234567`. */
export const NOVA_POST_PHONE_PATTERN = /^380\d{9}$/;

const positiveInt = z.number().int().positive().max(1_000_000_000);

const parcelSchema = z.strictObject({
  weightGrams: positiveInt,
  lengthMm: positiveInt,
  widthMm: positiveInt,
  heightMm: positiveInt,
});

export const novaPostSettingsSchema = z
  .strictObject({
    /** Contact person of the sender, at least two words: the calculation refuses "less than 2 words" (spike 7a rerun). */
    senderName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => name.split(/\s+/u).length >= 2, { params: { code: "two_words_required" } }),
    senderPhone: z.string().regex(NOVA_POST_PHONE_PATTERN),
    senderEmail: z.email().max(100).optional(),
    /** EDRPOU or another tax id of a legal entity; with `senderCompanyName`, or neither (a private person). */
    senderCompanyTin: z
      .string()
      .regex(/^\d{8,20}$/)
      .optional(),
    senderCompanyName: z.string().trim().min(1).max(100).optional(),
    /** The integer division id where parcels are handed in (`GET /divisions`, never `externalId`). */
    senderDivisionId: positiveInt,
    /** Who pays the carrier in an estimate (a waybill uses the admin's choice). */
    payerDefault: z.enum(["Sender", "Recipient"]),
    /** Non-cash payment by the sender (2 to 20 characters; EDRPOU accepted for Ukraine). */
    payerContractNumber: z.string().trim().min(2).max(20).optional(),
    /** The parcel an estimate assumes when the request names none. */
    defaultParcel: parcelSchema,
  })
  .superRefine((settings, context) => {
    if ((settings.senderCompanyTin === undefined) !== (settings.senderCompanyName === undefined)) {
      context.addIssue({
        code: "custom",
        path: [settings.senderCompanyTin === undefined ? "senderCompanyTin" : "senderCompanyName"],
        params: { code: "company_tin_and_name_together" },
        message: "senderCompanyTin and senderCompanyName go together",
      });
    }
  });

export type NovaPostSettings = z.output<typeof novaPostSettingsSchema>;

/** The issue code of one zod issue: a custom rule's own code, else zod's code (both short, no text). */
function codeOf(issue: z.core.$ZodIssue): string {
  const custom = (issue as { params?: { code?: unknown } }).params?.code;
  const code = typeof custom === "string" ? custom : issue.code;
  return CARRIER_CODE_PATTERN.test(code) ? code : "invalid";
}

function pathOf(issue: z.core.$ZodIssue): string {
  return issue.path.map(String).join(".");
}

/**
 * `validateSettings` of the port: the problems of `settings`, empty when they are a complete sender profile. Unknown keys
 * are refused (one issue per key).
 */
export function novaPostSettingsIssues(settings: unknown): ProviderSettingsIssue[] {
  const parsed = novaPostSettingsSchema.safeParse(settings);
  if (parsed.success) {
    return [];
  }
  const issues: ProviderSettingsIssue[] = [];
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        issues.push({ path: [...issue.path.map(String), key].join("."), code: "unknown_key" });
      }
    } else {
      issues.push({ path: pathOf(issue), code: codeOf(issue) });
    }
  }
  // A path built from a key a client sent can be anything: such an issue is reported on the object itself, never dropped
  // (an empty list would accept the settings). The API's port check allows at most 50 issues.
  return issues
    .map((issue) =>
      /^[A-Za-z0-9_.]{0,200}$/.test(issue.path) ? issue : { path: "", code: issue.code },
    )
    .slice(0, 50);
}

/** The settings when they are complete, `undefined` otherwise (an operation then answers `rejected`). */
export function parseNovaPostSettings(settings: unknown): NovaPostSettings | undefined {
  const parsed = novaPostSettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : undefined;
}
