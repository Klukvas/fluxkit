import { html, type EmailRenderContext, type SafeHtml } from "@fluxkit/core";
import { actionHtml } from "./account-mail-parts.js";
import { formatMessage } from "./email-messages.js";
import { formatOrderMoney } from "./order-mail-money.js";
import type { OrderPlacedVariables } from "./order-mail-variables.js";

/*
 * Shared pieces of the order mails: the item table, the totals and the optional order link, styled from `context.theme`
 * only. Pure: the same variables and context give the same bytes. Every value goes through the `html` tag (escaped).
 */

type Lines = OrderPlacedVariables["lines"];

function cellStyle(context: EmailRenderContext, align: "left" | "right"): string {
  const { theme } = context;
  return `padding:${theme.space.xs} 0;border-bottom:1px solid ${theme.color.border};text-align:${align};vertical-align:top;`;
}

/** The lines of an order: title (and variant), quantity, line total; a count of lines not shown. */
export function orderLinesHtml(
  context: EmailRenderContext,
  lines: Lines,
  currency: string,
  moreLines: number,
): SafeHtml {
  const { theme, messages } = context;
  const quantityLabel = (quantity: number) =>
    formatMessage(messages, "order.placed.quantity", { quantity: String(quantity) });
  const rows = lines.map((line) => {
    const variant =
      line.variantTitle === null
        ? html``
        : html`<br /><span
              style="color:${theme.color.mutedForeground};font-size:${theme.fontSize.small};"
              >${line.variantTitle}</span
            >`;
    return html`<tr>
      <td style="${cellStyle(context, "left")}">${line.title}${variant}</td>
      <td style="${cellStyle(context, "right")}">${quantityLabel(line.quantity)}</td>
      <td style="${cellStyle(context, "right")}">${formatOrderMoney(line.lineTotal, currency)}</td>
    </tr>`;
  });
  const more =
    moreLines > 0
      ? html`<p
          style="margin:${theme.space.xs} 0 0;color:${theme.color.mutedForeground};font-size:${theme.fontSize.small};"
        >
          ${formatMessage(messages, "order.placed.more_lines", { count: String(moreLines) })}
        </p>`
      : html``;
  return html`<table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      style="margin:0 0 ${theme.space.md};border-collapse:collapse;"
    >
      ${rows}
    </table>
    ${more}`;
}

export interface TotalRow {
  readonly label: string;
  readonly amount: number;
  readonly strong?: boolean;
}

/** Label and amount rows (subtotal, shipping, discount, total). */
export function totalsHtml(
  context: EmailRenderContext,
  rows: readonly TotalRow[],
  currency: string,
): SafeHtml {
  const { theme } = context;
  const cells = rows.map((row) => {
    const weight = row.strong === true ? "font-weight:bold;" : "";
    return html`<tr>
      <td style="padding:${theme.space.xs} 0;${weight}">${row.label}</td>
      <td style="padding:${theme.space.xs} 0;text-align:right;${weight}">
        ${formatOrderMoney(row.amount, currency)}
      </td>
    </tr>`;
  });
  return html`<table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="margin:0 0 ${theme.space.md};border-collapse:collapse;"
  >
    ${cells}
  </table>`;
}

/** The plain-text twin of `orderLinesHtml`. */
export function orderLinesText(
  context: EmailRenderContext,
  lines: Lines,
  currency: string,
  moreLines: number,
): string[] {
  const { messages } = context;
  const rows = lines.map((line) => {
    const title = line.variantTitle === null ? line.title : `${line.title} (${line.variantTitle})`;
    const quantity = formatMessage(messages, "order.placed.quantity", {
      quantity: String(line.quantity),
    });
    return `- ${title}, ${quantity}: ${formatOrderMoney(line.lineTotal, currency)}`;
  });
  if (moreLines > 0) {
    rows.push(formatMessage(messages, "order.placed.more_lines", { count: String(moreLines) }));
  }
  return rows;
}

export function totalsText(rows: readonly TotalRow[], currency: string): string[] {
  return rows.map((row) => `${row.label}: ${formatOrderMoney(row.amount, currency)}`);
}

/**
 * The link to the order as a button, and the same address as text, when the link source made one (an order of a deleted
 * account has none); `null` otherwise. The link is the one the API derived at render time, never a variable.
 */
export function orderLinkParts(
  context: EmailRenderContext,
  templateKey: string,
): { readonly html: SafeHtml; readonly text: string[] } {
  const href = context.links.action;
  if (href === null) {
    return { html: html``, text: [] };
  }
  const button = formatMessage(context.messages, `${templateKey}.button`);
  const hint = formatMessage(context.messages, `${templateKey}.link_hint`);
  return {
    html: actionHtml(context, href, button, hint),
    text: ["", `${button}: ${href}`],
  };
}
