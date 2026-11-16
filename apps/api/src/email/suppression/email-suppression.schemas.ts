import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../common/openapi-formats.js";
import { paginationQuerySchema, pageSchema } from "../../common/pagination.js";

export const listEmailSuppressionsQuerySchema = z.strictObject(paginationQuerySchema.shape);
export const emailSuppressionResponseSchema = z.object({
  id: uuidSchema,
  toAddress: z.string().meta({ description: "Full normalized recipient; requires email.manage." }),
  toAddressMasked: z.string().meta({ description: "Recipient masked for the default UI display." }),
  reason: z.enum(["hard_bounce", "complaint", "unsubscribe", "blocked"]),
  sourceProvider: z.string(),
  firstSeenAt: timestampSchema,
  lastSeenAt: timestampSchema,
});
export const emailSuppressionPageResponseSchema = pageSchema(emailSuppressionResponseSchema);
export type EmailSuppressionPageResponse = z.output<typeof emailSuppressionPageResponseSchema>;
