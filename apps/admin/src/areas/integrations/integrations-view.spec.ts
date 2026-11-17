import type { AdminIntegration, AdminIntegrationSecret } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { groupByKind, providerLabel, secretFieldLabel, secretView } from "./integrations-view";

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
    ...overrides,
  };
}

function integration(overrides: Partial<AdminIntegration> = {}): AdminIntegration {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "email",
    providerCode: "resend",
    enabled: false,
    secrets: [secret()],
    updatedAt: "2026-11-16T10:00:00.000Z",
    ...overrides,
  };
}

const stored = {
  versionId: VERSION,
  generation: 2,
  savedAt: "2026-11-16T11:00:00.000Z",
  keyAvailable: true,
} as const;

describe("labels", () => {
  it("translates the providers and fields the template ships and shows any other code as it is", () => {
    expect(providerLabel("nova_post")).toEqual({ key: "intg.provider.nova_post" });
    expect(providerLabel("acme_pay")).toEqual({ text: "acme_pay" });
    expect(secretFieldLabel("webhook_secret")).toEqual({ key: "intg.field.webhook_secret" });
    expect(secretFieldLabel("merchant_id")).toEqual({ text: "merchant_id" });
    // A code that is a property of every object is still only a code.
    expect(providerLabel("constructor")).toEqual({ text: "constructor" });
  });
});

describe("groupByKind", () => {
  it("orders the kinds email, payment, shipping, the providers by code, and drops empty kinds", () => {
    const groups = groupByKind([
      integration({ id: "a", kind: "shipping", providerCode: "nova_post" }),
      integration({ id: "b", kind: "email", providerCode: "resend" }),
      integration({ id: "c", kind: "email", providerCode: "brevo" }),
    ]);
    expect(
      groups.map((group) => [group.kind, group.items.map((item) => item.providerCode)]),
    ).toEqual([
      ["email", ["brevo", "resend"]],
      ["shipping", ["nova_post"]],
    ]);
    expect(groupByKind([])).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    const items = [integration({ id: "b" }), integration({ id: "a", providerCode: "brevo" })];
    groupByKind(items);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("secretView", () => {
  it("not set: enter, nothing to remove", () => {
    expect(secretView(secret(), "ready")).toEqual({
      statusKey: "intg.state.not_set",
      tone: "neutral",
      envVariable: null,
      savedAt: null,
      needsReentry: false,
      enter: { mode: "enter", disabled: false },
      removableVersionId: null,
    });
  });

  it("stored: replace and remove, with the saved date", () => {
    expect(secretView(secret({ state: "set", ...stored }), "ready")).toMatchObject({
      statusKey: "intg.state.set",
      tone: "warning",
      savedAt: stored.savedAt,
      enter: { mode: "replace", disabled: false },
      removableVersionId: VERSION,
    });
  });

  it("set on the server: read-only, names the variable, no enter or replace", () => {
    const view = secretView(secret({ state: "env" }), "ready");
    expect(view).toMatchObject({
      statusKey: "intg.state.env",
      envVariable: "RESEND_API_KEY",
      enter: null,
      removableVersionId: null,
    });
  });

  it("set on the server with an earlier stored version: still no enter, but the stored one can be removed", () => {
    const view = secretView(secret({ state: "env", ...stored }), "ready");
    expect(view.enter).toBeNull();
    expect(view.removableVersionId).toBe(VERSION);
    expect(view.savedAt).toBe(stored.savedAt);
  });

  it("storage disabled: the enter control stays but is disabled; removing needs no key", () => {
    expect(secretView(secret(), "disabled").enter).toEqual({ mode: "enter", disabled: true });
    const view = secretView(secret({ state: "set", ...stored, keyAvailable: false }), "disabled");
    expect(view.enter).toEqual({ mode: "replace", disabled: true });
    expect(view.removableVersionId).toBe(VERSION);
  });

  it("warns only when the server says it cannot decrypt the stored value", () => {
    expect(
      secretView(secret({ state: "set", ...stored, keyAvailable: false }), "ready").needsReentry,
    ).toBe(true);
    expect(secretView(secret({ state: "set", ...stored }), "ready").needsReentry).toBe(false);
    expect(secretView(secret(), "ready").needsReentry).toBe(false);
  });

  it("names the server variable only while the server value is in force", () => {
    expect(secretView(secret({ state: "set", ...stored }), "ready").envVariable).toBeNull();
  });
});
