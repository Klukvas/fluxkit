import { Injectable, SetMetadata } from "@nestjs/common";
import {
  EMAIL_PROVIDER_CODE_PATTERN,
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplate,
} from "@fluxkit/core";
import { z } from "zod";
import { BUILT_IN_EMAIL_CATALOGS, catalogsWithPrefix, formatMessage } from "./email-messages.js";
import { shopNameOf } from "./email-layout.js";
import type { RegisteredEmailTemplate } from "./email-renderer.js";
import type { EmailTemplateProvider } from "./email-template-provider.js";

const KEY = "admin.test";

const variablesSchema = z
  .object({
    /** The frozen primary code, retained for v1 compatibility; v2 describes the route. */
    providerCode: z.string().regex(EMAIL_PROVIDER_CODE_PATTERN),
  })
  .strict();

export type AdminTestVariables = z.infer<typeof variablesSchema>;

function renderVersion(
  variables: AdminTestVariables,
  context: EmailRenderContext,
  version: 1 | 2,
): EmailRenderOutput {
  const { messages, theme } = context;
  const shop = shopNameOf(context);
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body = formatMessage(
    messages,
    `${KEY}.${version === 1 ? "body" : "body_route"}`,
    version === 1 ? { provider: variables.providerCode } : {},
  );
  const note = formatMessage(messages, `${KEY}.note`);
  const headingStyle = `margin:0 0 ${theme.space.md};font-size:${theme.fontSize.heading};color:${theme.color.foreground};`;
  const paragraphStyle = `margin:0 0 ${theme.space.md};`;
  const noteStyle = `margin:0;color:${theme.color.mutedForeground};font-size:${theme.fontSize.small};`;
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { shop }),
    html: html`<h1 style="${headingStyle}">${heading}</h1>
      <p style="${paragraphStyle}">${body}</p>
      <p style="${noteStyle}">${note}</p>`,
    text: [heading, "", body, "", note].join("\n"),
  };
}

/**
 * `admin.test` (ADR 0031 decisions 14 and 15): the mail of the admin's "send test to my address" (plan step 9). Its only
 * variable is the provider code, so it holds no personal data.
 */
export const adminTestTemplate: EmailTemplate<AdminTestVariables> = Object.freeze({
  key: KEY,
  version: 2,
  category: "account",
  variablesSchema,
  sampleVariables: Object.freeze({ providerCode: "resend" }),
  displayVariables: Object.freeze(["providerCode"]),
  render: (variables: AdminTestVariables, context: EmailRenderContext) =>
    renderVersion(variables, context, 2),
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class AdminTestEmailTemplate implements EmailTemplateProvider<AdminTestVariables> {
  readonly template = adminTestTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}

/** Keeps queued v1 bytes stable; a feature override does not inherit this built-in compatibility renderer. */
export function resolveAdminTestVersion(
  entry: RegisteredEmailTemplate | undefined,
  version: number,
): RegisteredEmailTemplate | undefined {
  if (entry === undefined || entry.template.version === version) return entry;
  if (entry.template.key !== KEY || entry.source !== "AdminTestEmailTemplate" || version !== 1)
    return undefined;
  const template: EmailTemplate<AdminTestVariables> = Object.freeze({
    ...adminTestTemplate,
    version: 1,
    render: (variables: AdminTestVariables, context: EmailRenderContext) =>
      renderVersion(variables, context, 1),
  });
  return { ...entry, template: template as EmailTemplate<unknown> };
}
