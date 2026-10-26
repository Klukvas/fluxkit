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
export { OrderCancelledEmailTemplate, orderCancelledTemplate } from "./order-cancelled.template.js";
export { OrderExpiredEmailTemplate, orderExpiredTemplate } from "./order-expired.template.js";
export { OrderPaidEmailTemplate, orderPaidTemplate } from "./order-paid.template.js";
export { OrderPlacedEmailTemplate, orderPlacedTemplate } from "./order-placed.template.js";
export {
  ShipmentCreatedEmailTemplate,
  shipmentCreatedTemplate,
} from "./shipment-created.template.js";
export { formatOrderMoney } from "./order-mail-money.js";
export {
  boundedOrderMailText,
  ORDER_MAIL_MAX_LINES,
  type OrderClosedVariables,
  type OrderPaidVariables,
  type OrderPlacedVariables,
  type ShipmentCreatedVariables,
} from "./order-mail-variables.js";
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
