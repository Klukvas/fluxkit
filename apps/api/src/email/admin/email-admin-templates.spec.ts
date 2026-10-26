import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE_KEYS } from "@fluxkit/core";
import type { ProblemBody } from "../../common/problem.filter.js";
import { EmailAdminWorld } from "../../test/email-admin-world.js";
import { fixtureEmailTemplates, HOSTILE_SAMPLE_NAME } from "../../test/email-template-fixture.js";

interface TemplateListBody {
  items: { key: string; version: number; category: string; locales: string[] }[];
}

interface PreviewBody {
  key: string;
  version: number;
  locale: string;
  category: string;
  subject: string;
  html: string;
  text: string;
}

describe("admin email templates and preview (no database rows, no provider call)", () => {
  let ctx: EmailAdminWorld;

  beforeAll(async () => {
    ctx = await EmailAdminWorld.start({ extraFeatures: [fixtureEmailTemplates("hostile")] });
    await ctx.signInAs("manager");
  });

  afterAll(async () => {
    await ctx.stop();
  });

  it("lists every registered template with its key, version, category and locales, sorted by key", async () => {
    const result = await ctx.call<TemplateListBody>("GET", "/admin/email/templates");
    expect(result.status).toBe(200);
    const keys = result.body.items.map((item) => item.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual([...EMAIL_TEMPLATE_KEYS, "fixture.hostile"].sort());
    expect(result.body.items.find((item) => item.key === "order.placed")).toEqual({
      key: "order.placed",
      version: 1,
      category: "order",
      locales: ["en", "uk"],
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it.each(
    EMAIL_TEMPLATE_KEYS.flatMap((key) => ["uk", "en"].map((locale) => [key, locale] as const)),
  )("previews %s in %s from the template's sample variables", async (key, locale) => {
    const result = await ctx.call<PreviewBody>(
      "GET",
      `/admin/email/templates/${key}/preview?locale=${locale}`,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ key, version: 1, locale });
    expect(result.body.subject.length).toBeGreaterThan(0);
    expect(result.body.html).toContain("<");
    expect(result.body.text.length).toBeGreaterThan(0);
    expect(result.headers.get("content-type")).toContain("application/json");
  });

  it("uses DEFAULT_LOCALE without ?locale and sends no real address or link: the sample links point at the example origin", async () => {
    const result = await ctx.call<PreviewBody>(
      "GET",
      "/admin/email/templates/customer.password_reset/preview",
    );
    expect(result.status).toBe(200);
    expect(result.body.locale).toBe("uk");
    expect(result.body.text).toContain("https://shop.example.com/uk/");
    expect(result.body.html).not.toContain("shop@example.com");
  });

  it("answers with strict no-store, no sniffing and a CSP that allows nothing, whatever opens the response", async () => {
    const result = await ctx.call("GET", "/admin/email/templates/admin.test/preview?locale=en");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("prints hostile sample variables escaped, in the html part and as a JSON string", async () => {
    const result = await ctx.call<PreviewBody>(
      "GET",
      "/admin/email/templates/fixture.hostile/preview?locale=en",
    );
    expect(result.status).toBe(200);
    expect(HOSTILE_SAMPLE_NAME).toContain("<script>");
    expect(result.body.html).not.toContain("<script>");
    expect(result.body.html).not.toMatch(/<img\b[^>]*onerror/i);
    expect(result.body.html).toContain("&lt;script&gt;");
    expect(result.body.html).toContain("&quot;");
    expect(result.body.subject).not.toMatch(/[\r\n]/);
    // The plain text part is text: it keeps the characters and is never markup.
    expect(result.body.text).toContain(HOSTILE_SAMPLE_NAME);
  });

  it("answers 404 for an unknown template and 400 for a locale that is not configured or a key that is no key", async () => {
    expect((await ctx.call("GET", "/admin/email/templates/nothing.here/preview")).status).toBe(404);
    const locale = await ctx.call<ProblemBody>(
      "GET",
      "/admin/email/templates/admin.test/preview?locale=de",
    );
    expect(locale.status).toBe(400);
    expect(locale.body.errors).toEqual([
      expect.objectContaining({ path: "locale", code: "invalid_value" }),
    ]);
    const key = await ctx.call<ProblemBody>("GET", "/admin/email/templates/Not%20A%20Key/preview");
    expect(key.status).toBe(400);
    const extra = await ctx.call<ProblemBody>(
      "GET",
      "/admin/email/templates/admin.test/preview?locale=en&x=1",
    );
    expect(extra.status).toBe(400);
  });

  it("writes nothing and calls no provider", async () => {
    await ctx.call("GET", "/admin/email/templates/order.placed/preview?locale=uk");
    expect(await ctx.world.count()).toBe(0);
    expect(ctx.world.provider().calls).toEqual([]);
  });
});
