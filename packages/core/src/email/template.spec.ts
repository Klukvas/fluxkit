import { describe, expect, it } from "vitest";
import { z } from "zod";
import { html } from "./html.js";
import {
  buildEmailDedupeKey,
  checkEmailRenderOutput,
  checkEmailTemplateDefinition,
  EMAIL_TEMPLATE_CATEGORIES,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  isEmailLocale,
  isEmailTemplateKey,
  type EmailRenderContext,
  type EmailTemplate,
  type EmailTheme,
} from "./template.js";

const theme: EmailTheme = {
  color: {
    background: "#ffffff",
    foreground: "#000000",
    muted: "#eeeeee",
    mutedForeground: "#333333",
    border: "#dddddd",
    primary: "#0000ff",
    primaryForeground: "#ffffff",
    danger: "#aa0000",
    success: "#00aa00",
    warning: "#aa5500",
  },
  font: { sans: "sans-serif", mono: "monospace" },
  radius: { sm: "4px", md: "8px", lg: "16px" },
  space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  fontSize: { small: "13px", body: "15px", heading: "20px" },
  lineHeight: "1.5",
  contentWidth: 600,
};

const context: EmailRenderContext = {
  locale: "en",
  messages: { "order.paid.subject": "Order {number} is paid" },
  theme,
  links: { storefront: "https://shop.example/en", action: null },
  shopName: "Fluxkit Demo Shop",
};

const variablesSchema = z.object({ number: z.string().min(1) }).strict();

/** A minimal template written against the contract, with a zod schema (the API's choice). */
const orderPaid: EmailTemplate<z.infer<typeof variablesSchema>> = {
  key: "order.paid",
  version: 1,
  category: "order",
  variablesSchema,
  sampleVariables: { number: "FK-12345" },
  render(variables, ctx) {
    const subject = (ctx.messages["order.paid.subject"] ?? "").replace(
      "{number}",
      variables.number,
    );
    return {
      subject,
      html: html`<p style="color:${ctx.theme.color.foreground}">${subject}</p>`,
      text: subject,
    };
  },
};

describe("template contract constants", () => {
  it("lists the nine built-in keys of ADR 0031 decision 14, each a valid key", () => {
    expect([...EMAIL_TEMPLATE_KEYS]).toEqual([
      "customer.password_reset",
      "customer.password_changed",
      "customer.verify_email",
      "order.placed",
      "order.paid",
      "order.cancelled",
      "order.expired",
      "shipment.created",
      "admin.test",
    ]);
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(isEmailTemplateKey(key), key).toBe(true);
    }
    expect([...EMAIL_TEMPLATE_CATEGORIES]).toEqual(["account", "order"]);
    expect(EMAIL_TEMPLATE_METADATA).toBe("fluxkit:email-template");
  });

  it("emailTemplateMetadata checks the key and defaults override to false", () => {
    expect(emailTemplateMetadata("order.paid")).toEqual({ key: "order.paid", override: false });
    expect(emailTemplateMetadata("order.paid", { override: true })).toEqual({
      key: "order.paid",
      override: true,
    });
    expect(() => emailTemplateMetadata("order")).toThrow(RangeError);
    expect(() => emailTemplateMetadata(`a.${"b".repeat(64)}`)).toThrow(RangeError);
  });

  it("isEmailLocale follows the sales_order locale pattern", () => {
    expect(isEmailLocale("uk")).toBe(true);
    expect(isEmailLocale("en-us")).toBe(true);
    for (const locale of ["", "EN", "u", "en_US", 1]) {
      expect(isEmailLocale(locale), String(locale)).toBe(false);
    }
  });
});

describe("checkEmailTemplateDefinition", () => {
  it("accepts a well-formed template with a zod schema", () => {
    expect(checkEmailTemplateDefinition(orderPaid as EmailTemplate<unknown>)).toEqual([]);
  });

  it("reports every broken rule", () => {
    const broken = {
      ...orderPaid,
      key: "Order",
      version: 0,
      category: "marketing",
      sampleVariables: { number: "" },
      render: undefined,
    } as unknown as EmailTemplate<unknown>;
    expect(checkEmailTemplateDefinition(broken)).toEqual([
      "key breaks EMAIL_TEMPLATE_KEY_PATTERN",
      "version is not a whole number of at least 1",
      "category is not account or order",
      "render is not a function",
      "sampleVariables do not pass variablesSchema",
    ]);
    const schemaless = {
      ...orderPaid,
      variablesSchema: undefined,
    } as unknown as EmailTemplate<unknown>;
    expect(checkEmailTemplateDefinition(schemaless)).toEqual(["variablesSchema has no safeParse"]);
  });

  it("accepts displayVariables as a list of distinct keys, and refuses anything else", () => {
    const withDisplay = (displayVariables: unknown) =>
      checkEmailTemplateDefinition({ ...orderPaid, displayVariables } as EmailTemplate<unknown>);
    expect(withDisplay(["number"])).toEqual([]);
    expect(withDisplay([])).toEqual([]);
    for (const bad of ["number", [1], [""], ["number", "number"], null]) {
      expect(withDisplay(bad), JSON.stringify(bad)).toEqual([
        "displayVariables is not a list of distinct, non-empty keys",
      ]);
    }
  });
});

describe("checkEmailRenderOutput", () => {
  it("accepts the output of a well-formed render, deterministically", () => {
    const first = orderPaid.render(orderPaid.sampleVariables, context);
    const second = orderPaid.render(orderPaid.sampleVariables, context);
    expect(checkEmailRenderOutput(first)).toEqual([]);
    expect(String(first.html)).toBe(String(second.html));
  });

  it("refuses a concatenated HTML string, a blank subject and a missing text part", () => {
    const output = {
      subject: "\r\n",
      html: "<p>concatenated</p>",
      text: "",
    } as unknown as ReturnType<typeof orderPaid.render>;
    expect(checkEmailRenderOutput(output)).toEqual([
      "subject is not a text that survives sanitizeSubject",
      "html was not built with the html tag",
      "text is missing or blank (the plain-text part is mandatory)",
    ]);
    expect(checkEmailRenderOutput({ subject: "x", html: html``, text: "x" })).toEqual([
      "html is blank",
    ]);
  });
});

describe("buildEmailDedupeKey", () => {
  const eventId = "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6";

  it("is <eventId>:<templateKey>", () => {
    expect(buildEmailDedupeKey(eventId, "order.placed")).toBe(`${eventId}:order.placed`);
  });

  it("refuses a malformed event id or template key", () => {
    expect(() => buildEmailDedupeKey("x", "order.placed")).toThrow(RangeError);
    expect(() => buildEmailDedupeKey(eventId.toUpperCase(), "order.placed")).toThrow(RangeError);
    expect(() => buildEmailDedupeKey(eventId, "order")).toThrow(RangeError);
    expect(() => buildEmailDedupeKey(eventId, "order.placed:x")).toThrow(RangeError);
  });
});
