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
import { formatOrderMoney } from "./order-mail-money.js";
import { orderLinkParts } from "./order-mail-parts.js";
import { orderPaidVariablesSchema, type OrderPaidVariables } from "./order-mail-variables.js";

const KEY = "order.paid";

function render(variables: OrderPaidVariables, context: EmailRenderContext): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const number = variables.orderNumber;
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body = formatMessage(messages, `${KEY}.body`, {
    shop,
    number,
    total: formatOrderMoney(variables.total, variables.currency),
  });
  const next = formatMessage(messages, `${KEY}.next`);
  const link = orderLinkParts(context, KEY);
  const note = formatMessage(messages, `${KEY}.note`, { shop });
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { number }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, body)}${paragraphHtml(
      context,
      next,
    )}${link.html}${noteHtml(context, note)}`,
    text: [heading, "", body, "", next, ...link.text, "", note].join("\n"),
  };
}

/** `order.paid` (plan 6.3): the payment arrived, the order is being prepared. */
export const orderPaidTemplate: EmailTemplate<OrderPaidVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "order",
  variablesSchema: orderPaidVariablesSchema,
  sampleVariables: Object.freeze({ orderNumber: "7K3M-9QX2", currency: "UAH", total: 248_000 }),
  displayVariables: Object.freeze(["orderNumber", "currency", "total"]),
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class OrderPaidEmailTemplate implements EmailTemplateProvider<OrderPaidVariables> {
  readonly template = orderPaidTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
