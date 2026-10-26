import { Injectable, SetMetadata } from "@nestjs/common";
import {
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplate,
} from "@fluxkit/core";
import { headingHtml, noteHtml, paragraphHtml } from "./account-mail-parts.js";
import { BUILT_IN_EMAIL_CATALOGS, catalogsWithPrefix, formatMessage } from "./email-messages.js";
import { shopNameOf } from "./email-layout.js";
import type { EmailTemplateProvider } from "./email-template-provider.js";
import { orderClosedVariablesSchema, type OrderClosedVariables } from "./order-mail-variables.js";

const KEY = "order.expired";

function render(variables: OrderClosedVariables, context: EmailRenderContext): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const number = variables.orderNumber;
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body = formatMessage(messages, `${KEY}.body`, { shop, number });
  const note = formatMessage(messages, `${KEY}.note`, { shop });
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { number }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, body)}${noteHtml(context, note)}`,
    text: [heading, "", body, "", note].join("\n"),
  };
}

/** `order.expired` (plan 6.3): no link (the order can no longer be paid) and no reason text in v1. */
export const orderExpiredTemplate: EmailTemplate<OrderClosedVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "order",
  variablesSchema: orderClosedVariablesSchema,
  sampleVariables: Object.freeze({ orderNumber: "7K3M-9QX2" }),
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class OrderExpiredEmailTemplate implements EmailTemplateProvider<OrderClosedVariables> {
  readonly template = orderExpiredTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
