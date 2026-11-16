import { describe, expect, it } from "vitest";
import {
  AdminTestEmailTemplate,
  resolveAdminTestVersion,
} from "../templates/admin-test.template.js";
import { renderEmail, type RegisteredEmailTemplate } from "../templates/email-renderer.js";
import { EMAIL_THEME } from "../templates/email-theme.js";
import { sampleEmailLinks } from "../templates/email-template-registry.js";
import type { EmailTemplate } from "@fluxkit/core";

const instance = new AdminTestEmailTemplate();
const entry: RegisteredEmailTemplate = {
  template: instance.template as EmailTemplate<unknown>,
  catalogs: instance.catalogs,
  source: "AdminTestEmailTemplate",
};

describe("built-in admin routing test version compatibility", () => {
  it.each(["en", "uk"])(
    "keeps queued v1 render stable while new v2 describes the route in %s",
    (locale) => {
      const options = {
        locale,
        defaultLocale: "en",
        theme: EMAIL_THEME,
        links: sampleEmailLinks(locale),
        shopName: null,
      };
      const old = resolveAdminTestVersion(entry, 1);
      expect(old?.template.version).toBe(1);
      if (old === undefined) throw new Error("missing retained admin test version");
      const legacy = renderEmail(old, { providerCode: "resend" }, options);
      const current = renderEmail(entry, { providerCode: "resend" }, options);
      expect(legacy.text).toContain("resend");
      expect(current.text).not.toContain("resend");
      expect(renderEmail(old, { providerCode: "resend" }, options)).toEqual(legacy);
      expect(current).not.toEqual(legacy);
    },
  );

  it("does not silently downgrade a feature override or an unknown version", () => {
    expect(resolveAdminTestVersion({ ...entry, source: "ForkAdminTest" }, 1)).toBeUndefined();
    expect(resolveAdminTestVersion(entry, 3)).toBeUndefined();
    expect(resolveAdminTestVersion(entry, 2)).toBe(entry);
  });
});
