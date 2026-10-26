export { AdminTestEmailTemplate, adminTestTemplate } from "./admin-test.template.js";
export {
  PasswordChangedEmailTemplate,
  passwordChangedTemplate,
} from "./customer-password-changed.template.js";
export {
  PasswordResetEmailTemplate,
  passwordResetTemplate,
} from "./customer-password-reset.template.js";
export { VerifyEmailEmailTemplate, verifyEmailTemplate } from "./customer-verify-email.template.js";
export {
  BUILT_IN_EMAIL_CATALOGS,
  catalogsWithPrefix,
  formatMessage,
  REQUIRED_EMAIL_LOCALES,
  type EmailCatalogs,
} from "./email-messages.js";
export {
  EmailRenderError,
  renderEmail,
  type RegisteredEmailTemplate,
  type RenderedEmail,
} from "./email-renderer.js";
export {
  buildEmailTemplateCatalog,
  EmailTemplateRegistry,
  sampleEmailLinks,
  type EmailTemplateSource,
} from "./email-template-registry.js";
export type { EmailTemplateProvider } from "./email-template-provider.js";
export { EMAIL_THEME } from "./email-theme.js";
export { EmailTemplatesModule } from "./email-templates.module.js";
