import { Injectable, SetMetadata } from "@nestjs/common";
import {
  AUTH_TOKEN_LIFETIME_MINUTES,
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplate,
} from "@fluxkit/core";
import { z } from "zod";
import {
  actionHtml,
  headingHtml,
  noteHtml,
  paragraphHtml,
  requireActionLink,
} from "./account-mail-parts.js";
import { BUILT_IN_EMAIL_CATALOGS, catalogsWithPrefix, formatMessage } from "./email-messages.js";
import { shopNameOf } from "./email-layout.js";
import type { EmailTemplateProvider } from "./email-template-provider.js";

const KEY = "customer.password_reset";

/** Only the token row id: the token itself is derived into the action link at render time and never stored. */
const variablesSchema = z.object({ tokenId: z.uuid() }).strict();

export type PasswordResetVariables = z.infer<typeof variablesSchema>;

function render(
  _variables: PasswordResetVariables,
  context: EmailRenderContext,
): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const link = requireActionLink(context);
  const minutes = String(AUTH_TOKEN_LIFETIME_MINUTES.password_reset);
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body = formatMessage(messages, `${KEY}.body`, { shop, minutes });
  const button = formatMessage(messages, `${KEY}.button`);
  const hint = formatMessage(messages, `${KEY}.link_hint`);
  const ignore = formatMessage(messages, `${KEY}.ignore`);
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { shop }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, body)}${actionHtml(
      context,
      link,
      button,
      hint,
    )}${noteHtml(context, ignore)}`,
    text: [heading, "", body, "", `${button}: ${link}`, "", ignore].join("\n"),
  };
}

/** `customer.password_reset` (ADR 0031 decision 10): the link to choose a new password, valid 60 minutes, single use. */
export const passwordResetTemplate: EmailTemplate<PasswordResetVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "account",
  variablesSchema,
  sampleVariables: Object.freeze({ tokenId: "00000000-0000-4000-8000-000000000001" }),
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class PasswordResetEmailTemplate implements EmailTemplateProvider<PasswordResetVariables> {
  readonly template = passwordResetTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
