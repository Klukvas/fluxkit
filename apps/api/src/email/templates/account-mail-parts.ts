import { html, type EmailRenderContext, type SafeHtml } from "@fluxkit/core";

/*
 * Shared pieces of the account mails (password reset, password changed, email verification): a heading, paragraphs and
 * one call-to-action link, styled from `context.theme` only. Pure: the same context gives the same bytes.
 */

/** The action link of the mail; a template that needs one and gets none is a bug of the link source. */
export function requireActionLink(context: EmailRenderContext): string {
  const action = context.links.action;
  if (action === null) {
    throw new Error("This mail needs an action link");
  }
  return action;
}

export function headingHtml(context: EmailRenderContext, text: string): SafeHtml {
  const { theme } = context;
  return html`<h1
    style="margin:0 0 ${theme.space.md};font-size:${theme.fontSize.heading};color:${
      theme.color.foreground
    };"
  >
    ${text}
  </h1>`;
}

export function paragraphHtml(context: EmailRenderContext, text: string): SafeHtml {
  return html`<p style="margin:0 0 ${context.theme.space.md};">${text}</p>`;
}

export function noteHtml(context: EmailRenderContext, text: string): SafeHtml {
  const { theme } = context;
  return html`<p
    style="margin:0;color:${theme.color.mutedForeground};font-size:${theme.fontSize.small};"
  >
    ${text}
  </p>`;
}

/** A link styled as a button, then the same address as text for clients that do not show the button. */
export function actionHtml(
  context: EmailRenderContext,
  href: string,
  label: string,
  hint: string,
): SafeHtml {
  const { theme } = context;
  const button = `display:inline-block;padding:${theme.space.sm} ${theme.space.lg};background-color:${theme.color.primary};color:${theme.color.primaryForeground};border-radius:${theme.radius.md};text-decoration:none;font-weight:bold;`;
  const hintStyle = `margin:0 0 ${theme.space.md};color:${theme.color.mutedForeground};font-size:${theme.fontSize.small};word-break:break-all;`;
  return html`<p style="margin:0 0 ${theme.space.md};">
      <a href="${href}" style="${button}">${label}</a>
    </p>
    <p style="${hintStyle}">
      ${hint}<br /><a href="${href}" style="color:${theme.color.primary};">${href}</a>
    </p>`;
}
