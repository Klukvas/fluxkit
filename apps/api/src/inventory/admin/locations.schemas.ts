import { z } from "zod";
import { uuidSchema } from "../../common/openapi-formats.js";

export const locationResponseSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});

export const locationListResponseSchema = z.object({ items: z.array(locationResponseSchema) });

export type LocationResponse = z.output<typeof locationResponseSchema>;
export type LocationListResponse = z.output<typeof locationListResponseSchema>;
