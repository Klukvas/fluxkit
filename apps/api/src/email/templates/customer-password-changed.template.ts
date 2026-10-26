import { Injectable, SetMetadata } from "@nestjs/common";
import {
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplate,
} from "@fluxkit/core";
import { z } from "zod";
import { headingHtml, noteHtml, paragraphHtml } from "./account-mail-parts.js";
import { BUILT_IN_EMAIL_CATALOGS, catalogsWithPrefix, formatMessage } from "./email-messages.js";
import { shopNameOf } from "./email-layout.js";
import type { EmailTemplateProvider } from "./email-template-provider.js";

const KEY = "customer.password_changed";

/** No variables: the notice carries no token and no personal data beyond the recipient. */
const variablesSchema = z.object({}).strict();

export type PasswordChangedVariables = z.infer<typeof variablesSchema>;

function render(
  _variables: PasswordChangedVariables,
  context: EmailRenderContext,
): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body = formatMessage(messages, `${KEY}.body`, { shop });
  const warning = formatMessage(messages, `${KEY}.warning`, { shop });
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { shop }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, body)}${noteHtml(
      context,
      warning,
    )}`,
    text: [heading, "", body, "", warning].join("\n"),
  };
}

/**
 * `customer.password_changed` (ADR 0031 decisions 10 and 16): sent after a password reset; tells the person every
 * session ended and to contact the shop if it was not them.
 */
export const passwordChangedTemplate: EmailTemplate<PasswordChangedVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "account",
  variablesSchema,
  sampleVariables: Object.freeze({}),
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class PasswordChangedEmailTemplate implements EmailTemplateProvider<PasswordChangedVariables> {
  readonly template = passwordChangedTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
