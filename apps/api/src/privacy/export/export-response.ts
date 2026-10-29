import type { PersonalDataExport } from "@fluxkit/core";
import type { Response } from "express";
import { z } from "zod";

/** `personal-data-<YYYY-MM-DD>.json`, the date of `generatedAt` (UTC). */
export function exportFilename(document: PersonalDataExport): string {
  return `personal-data-${document.generatedAt.slice(0, 10)}.json`;
}

/** A download, never cached (ADR 0033 decision 7). The JSON body itself is written by Nest. */
export function setExportHeaders(response: Response, document: PersonalDataExport): void {
  response.setHeader("Content-Disposition", `attachment; filename="${exportFilename(document)}"`);
  response.setHeader("Cache-Control", "no-store");
}

/** OpenAPI description of the document; the keys and rules are `docs/contracts/personal-data-export.md`. */
export const personalDataExportSchema = z
  .object({
    format: z.literal("fluxkit.personal-data-export/v1"),
    generatedAt: z.string().meta({ format: "date-time" }),
    subject: z.object({ kind: z.enum(["customer", "email"]) }),
    account: z.record(z.string(), z.unknown()).nullable(),
    orders: z.array(z.record(z.string(), z.unknown())),
    mail: z.array(z.record(z.string(), z.unknown())),
    sessions: z.array(z.record(z.string(), z.unknown())),
    cart: z.record(z.string(), z.unknown()).nullable(),
    processors: z.array(
      z.object({ kind: z.enum(["email", "payment", "shipping"]), name: z.string() }),
    ),
  })
  .meta({
    description:
      "The personal-data export `fluxkit.personal-data-export/v1` (docs/contracts/personal-data-export.md), sent as a download.",
  });
