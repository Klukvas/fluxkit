import { describe, expect, it } from "vitest";
import { hasHeaderUnsafeCharacter, type EmailTemplate } from "@fluxkit/core";
import { emailTheme } from "@fluxkit/theme";
import {
  FixtureGreetingTemplate,
  type GreetingVariables,
} from "../../test/email-template-fixture.js";
import { AdminTestEmailTemplate } from "./admin-test.template.js";
import { BUILT_IN_EMAIL_CATALOGS, formatMessage, LAYOUT_CATALOGS } from "./email-messages.js";
import { renderEmail, type RegisteredEmailTemplate } from "./email-renderer.js";
import { EMAIL_THEME } from "./email-theme.js";

const HOSTILE = `<script>alert(1)</script>"><img src=x onerror=alert(2)>'&javascript:alert(3)\r\nBcc: evil@example.org`;
const ESCAPED_SCRIPT =
  "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=alert(2)&gt;&#39;&amp;";

/** Every string leaf of `value` replaced by `HOSTILE`. */
function hostile(value: unknown): unknown {
  if (typeof value === "string") {
    return HOSTILE;
  }
  if (Array.isArray(value)) {
    return value.map(hostile);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, hostile(entry)]));
  }
  return value;
}

/** The entry with a schema that lets everything through: escaping must hold even for values a schema would refuse. */
function permissive(entry: RegisteredEmailTemplate): RegisteredEmailTemplate {
  return {
    ...entry,
    template: {
      ...entry.template,
      variablesSchema: { safeParse: (input: unknown) => ({ success: true, data: input }) },
    },
  };
}

function entryOf(provider: {
  template: EmailTemplate<never>;
  catalogs: RegisteredEmailTemplate["catalogs"];
}): RegisteredEmailTemplate {
  return {
    template: provider.template as EmailTemplate<unknown>,
    catalogs: provider.catalogs,
    source: "spec",
  };
}

const TEMPLATES: [string, RegisteredEmailTemplate][] = [
  ["admin.test", entryOf(new AdminTestEmailTemplate() as never)],
  ["fixture.greeting (a feature's template)", entryOf(new FixtureGreetingTemplate() as never)],
];

const options = (locale: string) => ({
  locale,
  defaultLocale: "uk",
  theme: EMAIL_THEME,
  links: { storefront: "https://shop.example.com/uk", action: "https://shop.example.com/uk/x#t=a" },
  shopName: HOSTILE,
});

describe("rendering with hostile values (ADR 0031 decision 14)", () => {
  it.each(TEMPLATES)("%s: every variable and the shop name are escaped in HTML", (_name, entry) => {
    for (const locale of ["uk", "en"]) {
      const variables = hostile(entry.template.sampleVariables);
      const mail = renderEmail(permissive(entry), variables, options(locale));
      expect(mail.html).not.toContain("<script");
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain('"><img');
      // No tag carries an event handler attribute (the escaped text may say "onerror", outside any tag).
      // Quoted attribute values are dropped first: an escaped value may contain the word, but no attribute can start there.
      expect(mail.html.replace(/"[^"]*"/g, '""')).not.toMatch(/<[^>]*\son\w+=/);
      expect(mail.html).toContain(ESCAPED_SCRIPT);
      // The only tags are the layout's and the template's own.
      const tags = new Set([...mail.html.matchAll(/<\/?([a-z0-9!]+)/g)].map((match) => match[1]));
      for (const tag of tags) {
        expect([
          "!doctype",
          "html",
          "head",
          "meta",
          "title",
          "body",
          "table",
          "tr",
          "td",
          "a",
          "br",
          "h1",
          "p",
          "ul",
          "li",
        ]).toContain(tag);
      }
    }
  });

  it.each(TEMPLATES)(
    "%s: the subject is header-safe and the plain-text part is there",
    (_name, entry) => {
      const mail = renderEmail(
        permissive(entry),
        hostile(entry.template.sampleVariables),
        options("en"),
      );
      expect(hasHeaderUnsafeCharacter(mail.subject)).toBe(false);
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect([...mail.subject].length).toBeLessThanOrEqual(200);
      expect(mail.text.trim().length).toBeGreaterThan(0);
    },
  );

  it("escapes a variable printed in an attribute and keeps the configured link as the only href base", () => {
    const entry = entryOf(new FixtureGreetingTemplate() as never);
    const variables: GreetingVariables = { name: `"onclick="x`, lines: [] };
    const mail = renderEmail(entry, variables, { ...options("en"), shopName: "Shop" });
    expect(mail.html).toContain('data-name="&quot;onclick=&quot;x"');
    for (const [, href] of mail.html.matchAll(/href="([^"]*)"/g)) {
      expect(href?.startsWith("https://shop.example.com/")).toBe(true);
    }
  });

  it("refuses variables that no longer pass the schema (variables_invalid)", () => {
    const entry = entryOf(new AdminTestEmailTemplate() as never);
    expect(() => renderEmail(entry, { providerCode: HOSTILE }, options("en"))).toThrow(
      expect.objectContaining({ code: "variables_invalid" }),
    );
  });
});

describe("the layout and the texts", () => {
  it("styles mail with the email theme only (a rebrand changes the tokens, not a template)", () => {
    const entry = entryOf(new AdminTestEmailTemplate() as never);
    const mail = renderEmail(
      entry,
      { providerCode: "resend" },
      { ...options("en"), shopName: null },
    );
    const colors = new Set(mail.html.match(/#[0-9a-fA-F]{3,8}\b/g));
    expect([...colors].every((color) => Object.values(emailTheme.color).includes(color))).toBe(
      true,
    );
    expect(mail.html).toContain(emailTheme.font.sans);
    expect(mail.html).not.toMatch(/<(script|img|link|style|iframe)\b/);
    expect(mail.html).not.toContain("var(--");
    expect(mail.text).toContain(
      formatMessage(LAYOUT_CATALOGS.en ?? {}, "layout.footer.account", { shop: "Online shop" }),
    );
  });

  it("is deterministic: the same stored input renders the same bytes", () => {
    const entry = entryOf(new AdminTestEmailTemplate() as never);
    const first = renderEmail(entry, { providerCode: "resend" }, options("uk"));
    const second = renderEmail(entry, { providerCode: "resend" }, options("uk"));
    expect(second).toEqual(first);
  });

  it("ships uk and en catalogs with the same keys, all of the layout or a built-in template, without markup", () => {
    const uk = Object.keys(BUILT_IN_EMAIL_CATALOGS.uk ?? {}).sort();
    const en = Object.keys(BUILT_IN_EMAIL_CATALOGS.en ?? {}).sort();
    expect(uk).toEqual(en);
    expect(Object.keys(BUILT_IN_EMAIL_CATALOGS).sort()).toEqual(["en", "uk"]);
    for (const key of uk) {
      expect(key).toMatch(/^(layout|admin\.test)\.[a-z0-9_.]+$/);
    }
    for (const catalog of Object.values(BUILT_IN_EMAIL_CATALOGS)) {
      for (const text of Object.values(catalog)) {
        expect(text).not.toMatch(/[<>]/);
        expect(text.trim()).toBe(text);
      }
    }
  });

  it("formatMessage fails loudly on a missing key, a missing value or a value without a placeholder", () => {
    const messages = { "a.b": "Hi {name}" };
    expect(formatMessage(messages, "a.b", { name: "Olena" })).toBe("Hi Olena");
    expect(() => formatMessage(messages, "a.c")).toThrow(/missing/);
    expect(() => formatMessage(messages, "a.b")).toThrow(/needs the value \{name\}/);
    expect(() => formatMessage(messages, "a.b", { name: "x", other: "y" })).toThrow(
      /no placeholder for other/,
    );
  });
});
