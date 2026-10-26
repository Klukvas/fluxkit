import { afterAll, describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_METADATA,
  emailTemplateMetadata,
  html,
  type EmailTemplate,
} from "@fluxkit/core";
import { z } from "zod";
import { startApp, type RunningApp } from "../../test/app.js";
import { fixtureEmailTemplates } from "../../test/email-template-fixture.js";
import { ensureMigrated } from "../../test/migrate.js";
import { adminTestTemplate, AdminTestEmailTemplate } from "./admin-test.template.js";
import {
  buildEmailTemplateCatalog,
  EmailTemplateRegistry,
  type EmailTemplateCandidate,
} from "./email-template-registry.js";

const KEY = "spec.sample";

function template(overrides: Partial<EmailTemplate<{ name: string }>> = {}): EmailTemplate<{
  name: string;
}> {
  return {
    key: KEY,
    version: 1,
    category: "order",
    variablesSchema: z.object({ name: z.string() }).strict(),
    sampleVariables: { name: "Olena" },
    render: (variables, context) => ({
      subject: `${context.messages[`${KEY}.subject`] ?? ""} ${variables.name}`,
      html: html`<p>${variables.name}</p>`,
      text: variables.name,
    }),
    ...overrides,
  };
}

const catalogs = {
  uk: { [`${KEY}.subject`]: "Привіт" },
  en: { [`${KEY}.subject`]: "Hello" },
};

function candidate(
  overrides: Partial<EmailTemplateCandidate> & { instance?: unknown } = {},
  name = "SpecTemplate",
): EmailTemplateCandidate {
  return {
    name,
    metadata: emailTemplateMetadata(KEY),
    instance: { template: template(), catalogs },
    isStatic: true,
    ...overrides,
  };
}

const builtIn: EmailTemplateCandidate = {
  name: "AdminTestEmailTemplate",
  metadata: emailTemplateMetadata("admin.test"),
  instance: new AdminTestEmailTemplate(),
  isStatic: true,
};

describe("buildEmailTemplateCatalog (registration checks)", () => {
  it("registers valid templates by key, sorted", () => {
    const catalog = buildEmailTemplateCatalog([candidate(), builtIn]);
    expect([...catalog.keys()]).toEqual(["admin.test", KEY]);
    expect(catalog.get("admin.test")?.template).toBe(adminTestTemplate);
    expect(catalog.get(KEY)?.source).toBe("SpecTemplate");
  });

  it("fails loudly on a duplicate key without override", () => {
    expect(() => buildEmailTemplateCatalog([candidate(), candidate({}, "Second")])).toThrow(
      /"spec.sample" is registered twice \(SpecTemplate and Second\); mark the replacement with override: true/,
    );
  });

  it("lets an override replace the template it names, whatever the discovery order", () => {
    const override = candidate(
      {
        metadata: emailTemplateMetadata(KEY, { override: true }),
        instance: { template: template({ version: 5 }), catalogs },
      },
      "Override",
    );
    for (const order of [
      [candidate(), override],
      [override, candidate()],
    ]) {
      const entry = buildEmailTemplateCatalog(order).get(KEY);
      expect(entry?.source).toBe("Override");
      expect(entry?.template.version).toBe(5);
    }
  });

  it("refuses two overrides of one key and an override of a key nobody registers", () => {
    const override = (name: string) =>
      candidate({ metadata: emailTemplateMetadata(KEY, { override: true }) }, name);
    expect(() => buildEmailTemplateCatalog([candidate(), override("A"), override("B")])).toThrow(
      /overridden twice/,
    );
    expect(() => buildEmailTemplateCatalog([override("A")])).toThrow(
      /overrides "spec.sample", which no other provider registers/,
    );
  });

  it.each([
    [
      "a missing locale",
      { template: template(), catalogs: { en: catalogs.en } },
      /lack the required locale uk/,
    ],
    [
      "catalogs with other keys",
      { template: template(), catalogs: { ...catalogs, en: { [`${KEY}.other`]: "x" } } },
      /do not have the same keys/,
    ],
    [
      "a key of another template",
      {
        template: template(),
        catalogs: { uk: { "order.subject": "x" }, en: { "order.subject": "x" } },
      },
      /has the key "order.subject", which does not start with spec.sample./,
    ],
    [
      "an empty text",
      { template: template(), catalogs: { ...catalogs, uk: { [`${KEY}.subject`]: " " } } },
      /no text for spec.sample.subject/,
    ],
    [
      "no schema",
      { template: template({ variablesSchema: undefined as never }), catalogs },
      /variablesSchema has no safeParse/,
    ],
    [
      "sample variables the schema refuses",
      { template: template({ sampleVariables: { name: 1 } as never }), catalogs },
      /sampleVariables do not pass variablesSchema/,
    ],
    [
      "a key that differs from the metadata",
      { template: template({ key: "spec.other" }), catalogs },
      /differs from the metadata/,
    ],
    [
      "no plain-text part",
      {
        template: template({
          render: () => ({ subject: "s", html: html`<p>x</p>`, text: "" }),
        }),
        catalogs,
      },
      /text is missing or blank/,
    ],
    [
      "HTML that was not built with the html tag",
      {
        template: template({
          render: () => ({ subject: "s", html: "<p>x</p>" as never, text: "t" }),
        }),
        catalogs,
      },
      /render_failed/,
    ],
    [
      "a render that throws (a missing text)",
      {
        template: template({
          render: () => {
            throw new RangeError('Email message "spec.sample.missing" is missing');
          },
        }),
        catalogs,
      },
      /do not render in uk \(render_failed\): Email message "spec.sample.missing" is missing/,
    ],
    [
      "a render that is not deterministic",
      {
        template: template({
          render: () => ({
            subject: "s",
            html: html`<p>${String(Math.random())}</p>`,
            text: "t",
          }),
        }),
        catalogs,
      },
      /render is not deterministic in uk/,
    ],
  ])("refuses %s", (_label, instance, message) => {
    expect(() => buildEmailTemplateCatalog([candidate({ instance })])).toThrow(message);
  });

  it("refuses a request-scoped provider, an instance without a template and a malformed key", () => {
    expect(() => buildEmailTemplateCatalog([candidate({ isStatic: false })])).toThrow(
      /must be a static provider/,
    );
    expect(() => buildEmailTemplateCatalog([candidate({ instance: { catalogs } })])).toThrow(
      /it has no template/,
    );
    expect(() =>
      buildEmailTemplateCatalog([candidate({ metadata: { key: "Bad Key", override: false } })]),
    ).toThrow(/declares an invalid key/);
  });

  it("ships admin.test among the v1 keys; the other built-ins come with plan steps 7 and 8", () => {
    expect(EMAIL_TEMPLATE_KEYS).toContain("admin.test");
    expect(Reflect.getMetadata(EMAIL_TEMPLATE_METADATA, AdminTestEmailTemplate)).toEqual({
      key: "admin.test",
      override: false,
    });
  });
});

describe("EmailTemplateRegistry (discovery in the application)", () => {
  const apps: RunningApp[] = [];

  afterAll(async () => {
    for (const running of apps) {
      await running.app.close();
    }
  });

  it("finds the built-ins and a feature's template, and an override replaces it", async () => {
    await ensureMigrated();
    const plain = await startApp({ extraFeatures: [fixtureEmailTemplates("plain")] });
    apps.push(plain);
    const registry = plain.app.get(EmailTemplateRegistry);
    expect(registry.keys()).toEqual([
      "admin.test",
      "customer.password_changed",
      "customer.password_reset",
      "customer.verify_email",
      "fixture.greeting",
    ]);
    expect(registry.get("fixture.greeting")?.template.version).toBe(1);
    const overridden = await startApp({ extraFeatures: [fixtureEmailTemplates("override")] });
    apps.push(overridden);
    const replaced = overridden.app.get(EmailTemplateRegistry).get("fixture.greeting");
    expect(replaced?.source).toBe("FixtureGreetingOverride");
    expect(replaced?.template.version).toBe(2);
  });

  it("stops the startup on a duplicate key", async () => {
    await expect(startApp({ extraFeatures: [fixtureEmailTemplates("duplicate")] })).rejects.toThrow(
      /"fixture.greeting" is registered twice/,
    );
  });

  it("registers nothing a feature does not bring: without the feature, only the built-ins", async () => {
    const running = await startApp();
    apps.push(running);
    expect(running.app.get(EmailTemplateRegistry).keys()).toEqual([
      "admin.test",
      "customer.password_changed",
      "customer.password_reset",
      "customer.verify_email",
    ]);
  });
});
