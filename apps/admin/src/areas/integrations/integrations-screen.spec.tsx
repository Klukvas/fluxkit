import { formatDateTime } from "../../lib/format";
import type {
  AdminIntegration,
  AdminIntegrationCheck,
  AdminIntegrationSecret,
} from "@fluxkit/api-client";
import { createTranslator, locales } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { INTEGRATION_REFUSAL_RULES, VALUE_ERROR_CODES } from "./integrations-errors";
import {
  IntegrationsListView,
  STORAGE_KEY_VARIABLE,
  type IntegrationsState,
} from "./integrations-list-view";
import { INTEGRATION_KINDS, KNOWN_PROVIDER_CODES, KNOWN_SECRET_FIELDS } from "./integrations-view";
import { IntegrationCheckResult } from "./integration-versions";
import { GUIDED_PROVIDER_CODES, providerGuide } from "./provider-guides";
import { SecretDialogView, type SecretDialogViewProps } from "./secret-dialog-view";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const VERSION = "33333333-3333-4333-8333-333333333333";

function secret(overrides: Partial<AdminIntegrationSecret> = {}): AdminIntegrationSecret {
  return {
    field: "api_key",
    purpose: "outbound",
    envVariable: "RESEND_API_KEY",
    state: "not_set",
    last4: null,
    versionId: null,
    generation: null,
    savedAt: null,
    keyAvailable: null,
    versionState: null,
    ...overrides,
  };
}

const resend: AdminIntegration = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "email",
  providerCode: "resend",
  enabled: false,
  versions: [],
  environmentSource: "store",
  environment: "default",
  secrets: [
    secret({
      state: "set",
      versionId: VERSION,
      generation: 1,
      savedAt: "2026-11-16T11:00:00.000Z",
      keyAvailable: true,
      versionState: "candidate",
    }),
    secret({
      field: "webhook_secret",
      purpose: "webhook",
      envVariable: "RESEND_WEBHOOK_SECRET",
      state: "env",
    }),
  ],
  updatedAt: "2026-11-16T11:00:00.000Z",
};
const monobank: AdminIntegration = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "payment",
  providerCode: "monobank",
  enabled: false,
  versions: [],
  environmentSource: "store",
  environment: "default",
  secrets: [secret({ field: "token", envVariable: "MONOBANK_TOKEN" })],
  updatedAt: "2026-11-16T10:00:00.000Z",
};
const unknown: AdminIntegration = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "shipping",
  providerCode: "acme_ship",
  enabled: false,
  versions: [],
  environmentSource: "store",
  environment: "default",
  secrets: [secret({ field: "merchant_code", envVariable: "ACME_SHIP_MERCHANT_CODE" })],
  updatedAt: "2026-11-16T10:00:00.000Z",
};

function ready(
  items: AdminIntegration[],
  storage: "ready" | "disabled" = "ready",
): IntegrationsState {
  return { status: "ready", data: { revision: 7, storage, emailRouteMode: "equal", items } };
}

function list(state: IntegrationsState, options: { canManage?: boolean; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <IntegrationsListView
      t={sentinel}
      uiLocale="en"
      state={state}
      canManage={options.canManage ?? true}
      busy={options.busy ?? false}
      onRetry={noop}
      onAction={noop}
    />,
  );
}

function dialog(overrides: Partial<SecretDialogViewProps> = {}) {
  return renderToStaticMarkup(
    <SecretDialogView
      t={sentinel}
      action="enter"
      field="§field"
      provider="§provider"
      values={{ value: "", currentPassword: "" }}
      fieldErrors={{}}
      formErrors={[]}
      busy={false}
      onChange={noop}
      onSubmit={noop}
      onClose={noop}
      {...overrides}
    />,
  );
}

/** The opening tags of the buttons of a markup. */
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? [];
/** The attribute, not the `disabled:` utility classes every button carries. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);
const inputs = (html: string) => html.match(/<input[^>]*>/g) ?? [];

describe("the Integrations list", () => {
  it("says first that saved keys are stored and not used yet", () => {
    const html = list(ready([resend]));
    expect(html).toContain("§intg.inactive.title");
    expect(html).toContain("§intg.inactive.body");
    expect(html.indexOf("§intg.inactive.title")).toBeLessThan(html.indexOf("§intg.kind.email"));
    expect(html).not.toContain("§intg.storageDisabled.title");
  });

  it("shows kind-specific counts and oldest open work in both locales without a disposal action", async () => {
    for (const locale of ["en", "uk"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      for (const [kind, dependents] of [
        ["payment", { payments: { open: 2, total: 7, oldestOpenAt: "2024-01-01T00:00:00.000Z" } }],
        ["shipping", { shipments: { open: 0, total: 3, oldestOpenAt: null } }],
        ["email", { emails: { pending: 1, total: 4 } }],
      ] as const) {
        const integration: AdminIntegration = {
          ...monobank,
          kind,
          versions: [
            {
              id: VERSION,
              purpose: "outbound",
              generation: 1,
              state: "draining",
              environment: "default",
              createdAt: "2024-01-01T00:00:00.000Z",
              fields: ["token"],
              dependents,
            },
          ],
        };
        const html = renderToStaticMarkup(
          <IntegrationsListView
            t={t}
            uiLocale={locale}
            state={ready([integration])}
            canManage={true}
            busy={false}
            onRetry={noop}
            onAction={noop}
          />,
        );
        const key = kind === "payment" ? "payments" : kind === "shipping" ? "shipments" : "emails";
        const values = {
          open: kind === "payment" ? 2 : 0,
          total: kind === "payment" ? 7 : kind === "shipping" ? 3 : 4,
          pending: 1,
        };
        expect(html).toContain(t(`intg.dependents.${key}`, values));
        expect(html).toContain(t("intg.dependents.retention"));
        expect(html).toContain("tabular-nums");
        expect(html).not.toContain("§intg");
        expect(html).not.toContain(
          t("intg.action.removeLabel", { field: "token", provider: "Monobank" }),
        );
        if (kind === "payment")
          expect(html).toContain(
            t("intg.dependents.oldestOpen", {
              date: formatDateTime("2024-01-01T00:00:00.000Z", locale),
            }),
          );
        if (kind === "shipping") expect(html).toContain(t("intg.dependents.noneOpen"));
      }
    }
  });

  it("groups both LiqPay fields under one candidate and exposes only complete versions to Check", () => {
    const liqpay: AdminIntegration = {
      ...monobank,
      providerCode: "liqpay",
      secrets: [secret({ field: "public_key" }), secret({ field: "private_key" })],
      versions: [
        {
          id: VERSION,
          purpose: "outbound",
          generation: 2,
          state: "candidate",
          environment: "default",
          createdAt: "2026-11-27T12:00:00.000Z",
          dependents: { payments: { open: 0, total: 0, oldestOpenAt: null } },
          fields: ["public_key"],
        },
      ],
    };
    const incomplete = list(ready([liqpay]));
    expect(incomplete).toContain("§intg.version.title");
    expect(incomplete).toContain("§intg.version.fieldSaved");
    expect(incomplete).toContain("§intg.version.fieldMissing");
    expect(incomplete).not.toContain("§intg.check.action");
    const complete = list(
      ready([
        {
          ...liqpay,
          versions: [
            {
              ...{
                id: VERSION,
                purpose: "outbound" as const,
                generation: 2,
                state: "candidate" as const,
                environment: "default",
                createdAt: "2026-11-27T12:00:00.000Z",
              },
              dependents: { payments: { open: 0, total: 0, oldestOpenAt: null } },
              fields: ["public_key", "private_key"],
            },
          ],
        },
      ]),
    );
    expect(complete).toContain("§intg.check.action");
    expect(complete).not.toContain("§intg.version.fieldMissing");
    expect(complete).not.toContain("§intg.action.turnOnLabel");
  });

  it("renders an unknown plugin's fields and environments without a provider switch", async () => {
    const plugin: AdminIntegration = {
      ...unknown,
      providerCode: "custom<carrier>",
      secrets: [secret({ field: "merchant<code>" }), secret({ field: "signing_key" })],
      environments: {
        values: ["trial", "live"],
        default: "trial",
        envVariable: "CUSTOM_ENVIRONMENT",
      },
      versions: [
        {
          id: VERSION,
          purpose: "outbound",
          generation: 4,
          state: "active",
          environment: "trial<region>",
          createdAt: "2026-11-27T12:00:00.000Z",
          dependents: { payments: { open: 0, total: 0, oldestOpenAt: null } },
          fields: ["merchant<code>", "signing_key"],
        },
      ],
    };
    const t = createTranslator(
      {
        ...(await messagesForArea("en", MESSAGE_FILES)),
        "intg.version.environment": "{environment}",
        "intg.version.fieldSaved": "{field}",
        "intg.check.action": "§intg.check.action",
      },
      "en",
    );
    const html = renderToStaticMarkup(
      <IntegrationsListView
        t={t}
        uiLocale="en"
        state={ready([plugin])}
        canManage
        busy={false}
        onRetry={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain("custom&lt;carrier&gt;");
    expect(html).toContain("merchant&lt;code&gt;");
    expect(html).toContain("trial&lt;region&gt;");
    expect(html).toContain("§intg.check.action");
    expect(html).not.toContain("<carrier>");
  });

  it("keeps older draining versions revocable and revoked versions terminal", () => {
    const retained: AdminIntegration = {
      ...monobank,
      versions: [
        {
          id: VERSION,
          purpose: "outbound",
          generation: 1,
          state: "draining",
          environment: "default",
          createdAt: "2026-11-27T12:00:00.000Z",
          dependents: { payments: { open: 0, total: 0, oldestOpenAt: null } },
          fields: ["token"],
        },
        {
          id: "revoked",
          purpose: "outbound",
          generation: 2,
          state: "revoked",
          environment: "default",
          createdAt: "2026-11-27T12:00:00.000Z",
          dependents: { payments: { open: 0, total: 0, oldestOpenAt: null } },
          fields: ["token"],
        },
      ],
    };
    const html = list(ready([retained]));
    expect(
      textAttributes(html).filter((label) => label === "§intg.version.revokeLabel"),
    ).toHaveLength(1);
    expect(html.match(/§intg.check.action/g)).toHaveLength(1);
  });

  it("groups the providers by kind under translated names, an unknown provider and field under their codes", () => {
    const html = list(ready([unknown, monobank, resend]));
    const order = ["§intg.kind.email", "§intg.kind.payment", "§intg.kind.shipping"].map((key) =>
      html.indexOf(key),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("§intg.provider.resend");
    expect(html).toContain("§intg.provider.monobank");
    expect(html).toContain("§intg.field.token");
    expect(html).toContain("acme_ship");
    expect(html).toContain("merchant_code");
  });

  it("shows each secret's state: stored with its date, set on the server with the variable, not set", () => {
    const html = list(ready([resend, monobank]));
    expect(html).toContain("§intg.state.set");
    expect(html).toContain("§intg.secret.savedAt");
    expect(html).toContain("§intg.state.env");
    expect(html).toContain("§intg.secret.envNote");
    expect(html).toContain("§intg.state.not_set");
  });

  it("offers replace and remove for a stored value, enter for a missing one, and nothing to enter for a server value", () => {
    const html = list(ready([resend, monobank]));
    const labels = textAttributes(html);
    expect(labels).toEqual([
      "§intg.action.turnOnLabel",
      "§intg.action.replaceLabel",
      "§intg.action.removeLabel",
      "§intg.action.enterLabel",
    ]);
    expect(buttons(html)).toHaveLength(4);
  });

  it("offers turn on for a saved email key and no payment activation or DNS control", () => {
    const html = list(ready([resend, monobank, unknown]));
    expect(html).toContain("§intg.action.turnOnLabel");
    expect(html).not.toMatch(/dns/i);
    expect(list(ready([monobank]))).not.toContain("§intg.action.turnOnLabel");
  });

  it("warns when the server cannot store keys, names the variable and disables every save control but not the removal", () => {
    const html = list(ready([resend, monobank], "disabled"));
    expect(html).toContain("§intg.storageDisabled.title");
    expect(html).toContain("§intg.storageDisabled.body");
    const state = buttons(html).map((button) => isDisabled(button));
    expect(state).toEqual([true, false, true]);
    expect(STORAGE_KEY_VARIABLE).toBe("SECRETS_ENCRYPTION_KEY");
  });

  it("warns that a stored value must be entered again when the server cannot decrypt it", () => {
    const lost: AdminIntegration = {
      ...monobank,
      versions: [],
      environmentSource: "store",
      environment: "default",
      secrets: [
        secret({
          field: "token",
          state: "set",
          versionId: VERSION,
          generation: 1,
          savedAt: "2026-11-16T11:00:00.000Z",
          keyAvailable: false,
          versionState: "candidate",
        }),
      ],
    };
    expect(list(ready([lost]))).toContain("§intg.secret.needsReentry");
    expect(list(ready([resend]))).not.toContain("§intg.secret.needsReentry");
  });

  it("disables every control while a write or a reload runs, and renders none without the permission", () => {
    expect(
      buttons(list(ready([resend, monobank]), { busy: true })).every((b) => isDisabled(b)),
    ).toBe(true);
    expect(buttons(list(ready([resend, monobank]), { canManage: false }))).toEqual([]);
  });

  it("opens every guide link in a new tab without an opener or a referrer, and only to the fixed https addresses", () => {
    const html = list(ready([resend, monobank]));
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
    expect(anchors.map((anchor) => /href="([^"]*)"/.exec(anchor)?.[1])).toEqual([
      "https://resend.com/signup",
      "https://api.monobank.ua/",
      "https://web.monobank.ua/",
    ]);
  });

  it("opens the guide of a provider nothing is set for and folds it once a value exists", () => {
    expect(list(ready([monobank]))).toMatch(/<details open=""/);
    expect(list(ready([resend]))).not.toMatch(/<details open=""/);
    expect(list(ready([unknown]))).not.toContain("<details");
  });

  it("explains where a webhook secret comes from next to that field", () => {
    expect(list(ready([resend]))).toContain("§intg.guide.resend.webhookSecret");
  });

  it("shows the empty state when no provider is installed, still with the notice", () => {
    const html = list(ready([]));
    expect(html).toContain("§intg.empty.title");
    expect(html).toContain("§intg.inactive.title");
  });

  it("shows loading, a failure with a retry, and a refusal instead of the list", () => {
    expect(list({ status: "loading" })).toContain("§status.loading");
    const failed = list({ status: "error", failure: { kind: "network" } });
    expect(failed).toContain("§errors.network");
    expect(failed).toContain("§action.retry");
    expect(list({ status: "forbidden" })).toContain("§error.forbiddenData");
  });

  it("renders no hardcoded text", () => {
    const html = list(ready([resend, monobank]));
    const data = ["RESEND_WEBHOOK_SECRET", "Nov", "AM", "PM", "at"];
    const visible = data.reduce((text, word) => text.replaceAll(word, " "), leftoverText(html));
    expect(visible.replace(/[\s,:.]+/g, "")).toBe("");
  });
});

describe("credential check outcomes", () => {
  it("never renders arbitrary provider text as a check outcome", () => {
    const result = {
      versionId: VERSION,
      code: "hostile_provider_message",
      checkedAt: "2026-11-27T12:00:00.000Z",
    } as unknown as AdminIntegrationCheck;
    const html = renderToStaticMarkup(
      <IntegrationCheckResult t={sentinel} uiLocale="en" result={result} />,
    );
    expect(html).toContain("§intg.check.failed");
    expect(html).not.toContain("hostile_provider_message");
  });

  it("renders only translated code outcomes, the check time and bounded wait", async () => {
    for (const locale of locales) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      const t = createTranslator(messages, locale);
      for (const code of [
        "ok",
        "invalid_credentials",
        "unavailable",
        "rate_limited",
        "not_supported",
      ] as const) {
        const html = renderToStaticMarkup(
          <IntegrationCheckResult
            t={t}
            uiLocale={locale}
            result={{
              versionId: VERSION,
              code,
              checkedAt: "2026-11-27T12:00:00.000Z",
              retryAfterSeconds: 60,
            }}
          />,
        );
        expect(html).toContain(messages[`intg.check.${code}`]);
        expect(html).not.toContain("intg.");
        expect(html).toContain("60");
      }
    }
  });
});

describe("the save and remove dialog", () => {
  it("asks for the key and the password in two password inputs that no browser store may fill or keep", () => {
    const fields = inputs(dialog());
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field).toContain('type="password"');
      expect(field).toContain('autoComplete="off"');
      expect(field).not.toMatch(/\sname=/);
      expect(field).toContain('value=""');
    }
  });

  it("offers only declared environments when saving and none for a password-only action", () => {
    const environment = {
      values: ["sandbox", "production"],
      default: "sandbox",
      envVariable: "CUSTOM_ENVIRONMENT",
    };
    const html = dialog({
      environments: environment,
      environment: "sandbox",
      onEnvironmentChange: noop,
    });
    expect(html).toContain("§intg.dialog.environment");
    expect(html).toContain('value="sandbox" selected=""');
    expect(html).toContain('value="production"');
    expect(
      dialog({
        action: "revoke",
        environments: environment,
        environment: "sandbox",
        onEnvironmentChange: noop,
      }),
    ).not.toContain("<select");
  });

  it("asks only for the password to remove, on a danger button", () => {
    const html = dialog({ action: "remove" });
    expect(inputs(html)).toHaveLength(1);
    expect(html).toContain("§intg.dialog.remove.title");
    expect(html).toContain("§intg.dialog.remove.submit");
    expect(html).not.toContain("§intg.dialog.value");
  });

  it("submits as a post form without an action, so a submit before the script runs puts nothing in the URL", () => {
    const form = /<form[^>]*>/.exec(dialog())?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).not.toContain("action=");
  });

  it("shows a field error on its field and a refusal as an alert", () => {
    const html = dialog({
      fieldErrors: {
        value: { key: "intg.error.value.invalid_format" },
        currentPassword: { key: "intg.error.passwordIncorrect" },
      },
      formErrors: [{ key: "intg.refusal.rateLimitedWait", values: { minutes: 3 } }],
    });
    expect(html).toContain("§intg.error.value.invalid_format");
    expect(html).toContain("§intg.error.passwordIncorrect");
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html).toContain('role="alert"');
    expect(html).toContain("§intg.refusal.rateLimitedWait");
  });

  it("locks both buttons while the request runs", () => {
    const html = dialog({ busy: true });
    expect(buttons(html).every((button) => isDisabled(button))).toBe(true);
    expect(html).toContain("§intg.dialog.enter.submitting");
  });

  it("renders no hardcoded text in any mode", () => {
    for (const action of ["enter", "replace", "remove", "turnOn", "turnOff", "revoke"] as const) {
      expect(leftoverText(dialog({ action })), action).toBe("");
    }
  });
});

describe("the area's messages", () => {
  it("has a text in both languages for every key the screen builds from data", async () => {
    const keys = [
      ...INTEGRATION_KINDS.map((kind) => `intg.kind.${kind}`),
      ...KNOWN_PROVIDER_CODES.map((code) => `intg.provider.${code}`),
      ...KNOWN_SECRET_FIELDS.map((field) => `intg.field.${field}`),
      ...["not_set", "set", "env", "active", "draining", "revoked"].map(
        (state) => `intg.state.${state}`,
      ),
      ...INTEGRATION_REFUSAL_RULES.map((rule) => `intg.refusal.${rule}`),
      ...VALUE_ERROR_CODES.map((code) => `intg.error.value.${code}`),
      ...[
        "saved",
        "removed",
        "turnedOn",
        "turnedOff",
        "revoked",
        "routeSaved",
        "stale",
        "unknown",
      ].map((notice) => `intg.notice.${notice}`),
      ...["enter", "replace", "remove", "turnOn", "turnOff", "revoke"].flatMap((action) => [
        `intg.action.${action}`,
        `intg.action.${action}Label`,
        `intg.dialog.${action}.title`,
        `intg.dialog.${action}.description`,
        `intg.dialog.${action}.submit`,
        `intg.dialog.${action}.submitting`,
      ]),
      ...GUIDED_PROVIDER_CODES.flatMap((code) => {
        const guide = providerGuide(code);
        return guide === null
          ? []
          : [
              ...guide.stepKeys,
              ...guide.links.map((link) => link.labelKey),
              ...Object.values(guide.fieldHintKeys),
            ];
      }),
    ];
    expect(keys.length).toBeGreaterThan(60);
    for (const locale of locales) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of keys) expect(messages[key], `${locale} ${key}`).toBeTypeOf("string");
    }
  });

  it("renders the list with the real messages of each language", async () => {
    for (const locale of locales) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const html = renderToStaticMarkup(
        <IntegrationsListView
          t={t}
          uiLocale={locale}
          state={ready([resend, monobank], "disabled")}
          canManage
          busy={false}
          onRetry={noop}
          onAction={noop}
        />,
      );
      expect(html).toContain("SECRETS_ENCRYPTION_KEY");
      expect(html).toContain("RESEND_WEBHOOK_SECRET");
      expect(html).not.toContain("intg.");
    }
  });
});

describe("the provider guides", () => {
  it("cover the shipped providers, each with steps and https links to the provider's own site", () => {
    expect([...GUIDED_PROVIDER_CODES].sort()).toEqual([
      "brevo",
      "liqpay",
      "monobank",
      "nova_post",
      "resend",
    ]);
    const hosts = GUIDED_PROVIDER_CODES.flatMap((code) =>
      (providerGuide(code)?.links ?? []).map((link) => new URL(link.href)),
    );
    expect(hosts.every((url) => url.protocol === "https:")).toBe(true);
    expect([...new Set(hosts.map((url) => url.host))].sort()).toEqual([
      "api.monobank.ua",
      "new.novaposhta.ua",
      "onboarding.brevo.com",
      "resend.com",
      "web.monobank.ua",
      "www.liqpay.ua",
    ]);
    for (const code of GUIDED_PROVIDER_CODES) {
      expect(providerGuide(code)?.stepKeys.length, code).toBeGreaterThanOrEqual(3);
    }
  });

  it("has none for a provider it does not know, whatever the code", () => {
    expect(providerGuide("fake")).toBeNull();
    expect(providerGuide("constructor")).toBeNull();
    expect(providerGuide("__proto__")).toBeNull();
  });
});

it("locks the environment selector when the server owns its value", () => {
  const props = {
    t: sentinel,
    action: "enter" as const,
    field: "token",
    provider: "fixture",
    environments: {
      values: ["default", "sandbox"],
      default: "default",
      envVariable: "FIXTURE_ENVIRONMENT",
    },
    environment: "sandbox",
    environmentSource: "env" as const,
    values: { value: "", currentPassword: "" },
    fieldErrors: {},
    formErrors: [],
    busy: false,
    onChange: noop,
    onSubmit: noop,
    onClose: noop,
  };
  const markup = renderToStaticMarkup(<SecretDialogView {...props} />);
  expect(markup).toMatch(/<select[^>]*disabled=""/);
});
