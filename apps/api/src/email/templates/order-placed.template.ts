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
import {
  orderLinesHtml,
  orderLinesText,
  orderLinkParts,
  totalsHtml,
  totalsText,
  type TotalRow,
} from "./order-mail-parts.js";
import { formatUtcDateTime } from "./order-mail-time.js";
import {
  ORDER_PLACED_SAMPLE,
  orderPlacedVariablesSchema,
  type OrderPlacedVariables,
} from "./order-mail-variables.js";

const KEY = "order.placed";

/** The delivery sentence of the order: the pickup point, the delivery city or just the method; none without a method. */
function deliveryLines(context: EmailRenderContext, variables: OrderPlacedVariables): string[] {
  const { messages } = context;
  const { methodTitle, pickupPoint, city } = variables.delivery;
  const lines: string[] = [];
  if (methodTitle !== null) {
    lines.push(formatMessage(messages, `${KEY}.delivery_method`, { method: methodTitle }));
  }
  if (pickupPoint !== null) {
    lines.push(
      formatMessage(messages, `${KEY}.delivery_pickup`, {
        number: pickupPoint.number,
        city: pickupPoint.city,
        description: pickupPoint.description,
      }),
    );
  } else if (city !== null) {
    lines.push(formatMessage(messages, `${KEY}.delivery_city`, { city }));
  }
  return lines;
}

function render(variables: OrderPlacedVariables, context: EmailRenderContext): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const number = variables.orderNumber;
  const heading = formatMessage(messages, `${KEY}.heading`);
  const intro = formatMessage(messages, `${KEY}.intro`, { shop, number });
  const itemsHeading = formatMessage(messages, `${KEY}.items_heading`);
  const rows: TotalRow[] = [
    { label: formatMessage(messages, `${KEY}.subtotal`), amount: variables.subtotal },
    { label: formatMessage(messages, `${KEY}.shipping`), amount: variables.shipping },
    ...(variables.discount > 0
      ? [{ label: formatMessage(messages, `${KEY}.discount`), amount: variables.discount }]
      : []),
    { label: formatMessage(messages, `${KEY}.total`), amount: variables.total, strong: true },
  ];
  const delivery = deliveryLines(context, variables);
  const deliveryHeading = formatMessage(messages, `${KEY}.delivery_heading`);
  const payment =
    variables.payBefore === null
      ? null
      : formatMessage(messages, `${KEY}.payment_notice`, {
          deadline: formatUtcDateTime(variables.payBefore),
        });
  const link = orderLinkParts(context, KEY);
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { shop, number }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, intro)}${paragraphHtml(
      context,
      itemsHeading,
    )}${orderLinesHtml(context, variables.lines, variables.currency, variables.moreLines)}${totalsHtml(
      context,
      rows,
      variables.currency,
    )}${
      delivery.length === 0
        ? html``
        : html`${paragraphHtml(context, deliveryHeading)}${delivery.map((line) =>
            paragraphHtml(context, line),
          )}`
    }${payment === null ? html`` : paragraphHtml(context, payment)}${link.html}${noteHtml(
      context,
      formatMessage(messages, `${KEY}.note`, { shop }),
    )}`,
    text: [
      heading,
      "",
      intro,
      "",
      itemsHeading,
      ...orderLinesText(context, variables.lines, variables.currency, variables.moreLines),
      "",
      ...totalsText(rows, variables.currency),
      ...(delivery.length === 0 ? [] : ["", deliveryHeading, ...delivery]),
      ...(payment === null ? [] : ["", payment]),
      ...link.text,
      "",
      formatMessage(messages, `${KEY}.note`, { shop }),
    ].join("\n"),
  };
}

/**
 * `order.placed` (ADR 0031 decision 14, plan 6.3): the confirmation with the lines, totals, delivery and, while the
 * order awaits payment, the payment deadline. The link to the order is `context.links.action` (a guest's link carries the
 * derived token in the fragment; a customer's goes to the account page).
 */
export const orderPlacedTemplate: EmailTemplate<OrderPlacedVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "order",
  variablesSchema: orderPlacedVariablesSchema,
  sampleVariables: ORDER_PLACED_SAMPLE,
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class OrderPlacedEmailTemplate implements EmailTemplateProvider<OrderPlacedVariables> {
  readonly template = orderPlacedTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
