import type { EmailTheme } from "@fluxkit/core";
import { emailTheme } from "@fluxkit/theme";

/**
 * The design values every mail is rendered with (ADR 0031 decision 14): `emailTheme` of `@fluxkit/theme` (resolved light
 * values of `tokens.css`, guarded by its spec), bound here to the core `EmailTheme` shape of the template contract. A
 * rebrand changes the tokens, never a template or this file. The layout and the templates take colors, fonts, spacing
 * and sizes from `context.theme` only (`template-sources.spec.ts` refuses literal design values in `templates/`).
 */
export const EMAIL_THEME: EmailTheme = emailTheme;
