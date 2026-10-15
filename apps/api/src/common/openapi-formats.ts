import { z } from "zod";

// Response-only schemas: they describe values the API itself produces, so they carry the OpenAPI `format` as
// metadata instead of the long validation regexes that z.uuid() and z.iso.datetime() would add to the document.
export const uuidSchema = z.string().meta({ format: "uuid" });
export const timestampSchema = z
  .string()
  .meta({ format: "date-time", description: "ISO 8601, UTC." });
