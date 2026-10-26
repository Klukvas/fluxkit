import {
  html,
  type EmailRenderContext,
  type EmailRenderOutput,
  type EmailTemplateCategory,
  type SafeHtml,
} from "@fluxkit/core";
import { formatMessage } from "./email-messages.js";

/*
 * The built-in layout every mail is wrapped in (ADR 0031 decision 14): a table-based document with inline styles from
 * `context.theme` only (mail clients ignore CSS variables and `<style>` blocks unevenly), the system font stack, no web
 * fonts, no external images, no scripts, no tracking pixel. The header names the shop (the display name of
 * `EMAIL_FROM`), the footer says why the person received the mail (transactional only, decision 8). A template renders
 * the content; the layout is the same for every template, so a feature's mail looks like the shop's.
 */

/** The name a mail calls the shop: the display name of `EMAIL_FROM`, else the catalog's generic name. */
export function shopNameOf(context: EmailRenderContext): string {
  return context.shopName ?? formatMessage(context.messages, "layout.shop_fallback");
}

function footerOf(context: EmailRenderContext, category: EmailTemplateCategory): string {
  return formatMessage(context.messages, `layout.footer.${category}`, {
    shop: shopNameOf(context),
  });
}

/** The full HTML document around a template's content. */
export function layoutHtml(
  content: EmailRenderOutput,
  context: EmailRenderContext,
  category: EmailTemplateCategory,
  subject: string,
): SafeHtml {
  const { theme } = context;
  const shop = shopNameOf(context);
  const page = `margin:0;padding:0;background-color:${theme.color.muted};`;
  const outer = `padding:${theme.space.xl} ${theme.space.md};`;
  const card = `width:100%;max-width:${String(theme.contentWidth)}px;background-color:${theme.color.background};border:1px solid ${theme.color.border};border-radius:${theme.radius.md};border-collapse:separate;`;
  const text = `font-family:${theme.font.sans};font-size:${theme.fontSize.body};line-height:${theme.lineHeight};color:${theme.color.foreground};`;
  const header = `padding:${theme.space.lg} ${theme.space.lg} 0;font-family:${theme.font.sans};font-size:${theme.fontSize.heading};line-height:${theme.lineHeight};font-weight:bold;color:${theme.color.foreground};`;
  const body = `padding:${theme.space.lg};${text}`;
  const footer = `padding:${theme.space.md} ${theme.space.lg} ${theme.space.lg};border-top:1px solid ${theme.color.border};font-family:${theme.font.sans};font-size:${theme.fontSize.small};line-height:${theme.lineHeight};color:${theme.color.mutedForeground};`;
  const link = `color:${theme.color.primary};`;
  return html`<!doctype html>
    <html lang="${context.locale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>${subject}</title>
      </head>
      <body style="${page}">
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="${page}"
        >
          <tr>
            <td align="center" style="${outer}">
              <table
                role="presentation"
                width="${theme.contentWidth}"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="${card}"
              >
                <tr>
                  <td style="${header}">${shop}</td>
                </tr>
                <tr>
                  <td style="${body}">${content.html}</td>
                </tr>
                <tr>
                  <td style="${footer}">
                    ${footerOf(context, category)}<br /><a
                      href="${context.links.storefront}"
                      style="${link}"
                      >${formatMessage(context.messages, "layout.open_shop", { shop })}</a
                    >
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html> `;
}

/** The plain-text part: the template's text, then the footer and the shop link. */
export function layoutText(
  content: EmailRenderOutput,
  context: EmailRenderContext,
  category: EmailTemplateCategory,
): string {
  const shop = shopNameOf(context);
  return [
    content.text.trim(),
    "",
    "--",
    footerOf(context, category),
    `${formatMessage(context.messages, "layout.open_shop", { shop })}: ${context.links.storefront}`,
    "",
  ].join("\n");
}
