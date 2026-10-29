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
import { orderLinkParts } from "./order-mail-parts.js";
import {
  shipmentCreatedVariablesSchema,
  type ShipmentCreatedVariables,
} from "./order-mail-variables.js";

const KEY = "shipment.created";

function render(
  variables: ShipmentCreatedVariables,
  context: EmailRenderContext,
): EmailRenderOutput {
  const { messages } = context;
  const shop = shopNameOf(context);
  const number = variables.orderNumber;
  const heading = formatMessage(messages, `${KEY}.heading`);
  const body =
    variables.carrierTitle === null
      ? formatMessage(messages, `${KEY}.body_without_carrier`, { shop, number })
      : formatMessage(messages, `${KEY}.body`, { shop, number, carrier: variables.carrierTitle });
  const tracking = formatMessage(messages, `${KEY}.tracking`, {
    trackingNumber: variables.trackingNumber,
  });
  const hint = formatMessage(messages, `${KEY}.tracking_hint`);
  const link = orderLinkParts(context, KEY);
  const note = formatMessage(messages, `${KEY}.note`, { shop });
  return {
    subject: formatMessage(messages, `${KEY}.subject`, { number }),
    html: html`${headingHtml(context, heading)}${paragraphHtml(context, body)}${paragraphHtml(
      context,
      tracking,
    )}${paragraphHtml(context, hint)}${link.html}${noteHtml(context, note)}`,
    text: [heading, "", body, "", tracking, hint, ...link.text, "", note].join("\n"),
  };
}

/**
 * `shipment.created` (plan 6.3): the carrier accepted the waybill. The tracking number and the carrier's name as the
 * shop shows it; nothing about the recipient (the order mail has what the person already knows).
 */
export const shipmentCreatedTemplate: EmailTemplate<ShipmentCreatedVariables> = Object.freeze({
  key: KEY,
  version: 1,
  category: "order",
  variablesSchema: shipmentCreatedVariablesSchema,
  sampleVariables: Object.freeze({
    orderNumber: "7K3M-9QX2",
    carrierTitle: "Sample carrier",
    trackingNumber: "20450000000000",
  }),
  displayVariables: Object.freeze(["orderNumber", "carrierTitle", "trackingNumber"]),
  render,
});

@Injectable()
@SetMetadata(EMAIL_TEMPLATE_METADATA, emailTemplateMetadata(KEY))
export class ShipmentCreatedEmailTemplate implements EmailTemplateProvider<ShipmentCreatedVariables> {
  readonly template = shipmentCreatedTemplate;
  readonly catalogs = catalogsWithPrefix(BUILT_IN_EMAIL_CATALOGS, `${KEY}.`);
}
