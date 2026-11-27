import { Injectable, SetMetadata } from "@nestjs/common";
import {
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailTemplate,
  type EmailRenderContext,
} from "@fluxkit/core";
import { z } from "zod";
import { BUILT_IN_EMAIL_CATALOGS, catalogsWithPrefix, formatMessage } from "./email-messages.js";
import type { EmailTemplateProvider } from "./email-template-provider.js";

const KEY = "integration.security_alert";
const variablesSchema = z.strictObject({
  action: z.enum([
    "integration.secret_changed",
    "integration.activated",
    "integration.disabled",
    "integration.revoked",
  ]),
  kind: z.enum(["email", "payment", "shipping"]),
  providerCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  generation: z.number().int().min(1),
  occurredAt: z.iso.datetime(),
});
type Variables = z.infer<typeof variablesSchema>;

export const integrationSecurityAlertTemplate: EmailTemplate<Variables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "account",
  variablesSchema,
  sampleVariables: Object.freeze({
    action: "integration.secret_changed" as const,
    kind: "payment" as const,
    providerCode: "demo",
    generation: 1,
    occurredAt: "2026-11-27T12:00:00.000Z",
  }),
  displayVariables: Object.freeze(["action", "kind", "providerCode", "generation", "occurredAt"]),
  render(variables: Variables, context: EmailRenderContext) {
    const subject = formatMessage(context.messages, `${KEY}.subject`);
    const heading = formatMessage(context.messages, `${KEY}.heading`);
    const body = formatMessage(context.messages, `${KEY}.body`, {
      action: variables.action,
      kind: variables.kind,
      provider: variables.providerCode,
      generation: String(variables.generation),
      occurredAt: variables.occurredAt,
    });
    const note = formatMessage(context.messages, `${KEY}.note`);
    const style = `margin:0 0 ${context.theme.space.md};`;
    return {
      subject,
      html: html`<h1 style="${style}">${heading}</h1>
        <p style="${style}">${body}</p>
        <p>${note}</p>`,
      text: [heading, "", body, "", note].join("\n"),
    };
  },
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class IntegrationSecurityAlertEmailTemplate implements EmailTemplateProvider<Variables> {
  readonly template = integrationSecurityAlertTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
