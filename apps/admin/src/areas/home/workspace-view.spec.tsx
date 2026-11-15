import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import type { ResourceView } from "../../lib/use-resource";
import { messagesWith } from "../../messages";
import enHome from "../../messages/en/home.json";
import ukHome from "../../messages/uk/home.json";
import { renderInRouter } from "../../test-helpers";
import { ghostLinkClass, secondaryLinkClass } from "../../views/links";
import { HomeView } from "./home-page";
import { COUNTERS, QUICK_ACTIONS } from "./workspace-model";
import { CounterView, WorkspaceView } from "./workspace-view";

const noop = () => undefined;
const t = createTranslator(messagesWith("en", { home: enHome }), "en");
const states: ResourceView<{ total: number }>[] = [
  { status: "loading", reload: noop },
  { status: "ready", data: { total: 0 }, reload: noop },
  { status: "error", failure: { kind: "network" }, reload: noop },
  { status: "forbidden", reload: noop },
  { status: "ready", data: { total: 1200 }, reload: noop },
];

describe("workspace view", () => {
  it("renders every quick action as an outlined secondary link without a ghost or primary look", () => {
    const html = renderInRouter(<WorkspaceView t={t} counters={[]} actions={QUICK_ACTIONS} />);
    const links = [...html.matchAll(/<a\b[^>]*class="([^"]*)"[^>]*>/g)];
    expect(links).toHaveLength(QUICK_ACTIONS.length);
    for (const [, className] of links) {
      expect(className).toBe(secondaryLinkClass);
      expect(className).not.toBe(ghostLinkClass);
      expect(className).not.toContain("bg-primary");
    }
  });

  it("shows independent states, native link names and a labelled retry outside the link", () => {
    const counters = COUNTERS.map((counter, index) => {
      const state = states[index];
      if (state === undefined) throw new Error("Missing test state");
      return (
        <CounterView
          key={counter.id}
          counter={counter}
          t={t}
          state={state}
          total={index === 1 ? "0" : "1,200"}
          onRetry={noop}
        />
      );
    });
    const html = renderInRouter(
      <HomeView
        t={t}
        workspace={<WorkspaceView t={t} counters={counters} actions={QUICK_ACTIONS} />}
        checklist={<div>checklist-slot</div>}
      />,
    );
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/Loading this counter…<\/span><span[^>]*>Orders awaiting payment/);
    expect(html).toMatch(/>0<\/span><span[^>]*>Paid orders awaiting fulfilment/);
    expect(html).toMatch(/>1,200<\/span><span[^>]*>Active products/);
    expect(html).toContain(t("home.counter.forbidden"));
    expect(html).toContain(t("home.counter.unavailable"));
    expect(html).toContain(t("errors.network"));
    expect(html).toContain('aria-label="Try again: Customers"');
    expect(html.match(/<button /g)).toHaveLength(1);
    for (const link of html.matchAll(/<a\b[^>]*>(.*?)<\/a>/g))
      expect(link[1]).not.toContain("<button");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("bg-primary");
    expect(html.match(/aria-hidden="true" class="inline-flex size-5/g)).toHaveLength(3);
    expect(html.indexOf("checklist-slot")).toBeGreaterThan(html.indexOf("Quick actions"));
    expect(html).toContain('href="/admin-ui/products/new"');
    expect(html).toContain('href="/admin-ui/orders?status=paid"');
  });

  it("renders unexpected 404 locally with retry, but forbidden without retry", () => {
    for (const status of ["notFound", "forbidden"] as const) {
      const html = renderInRouter(
        <CounterView t={t} counter={COUNTERS[0]} state={{ status, reload: noop }} onRetry={noop} />,
      );
      expect(html).toContain('href="/admin-ui/orders?status=awaiting_payment"');
      expect(html.includes("<button")).toBe(status === "notFound");
      expect(html).not.toContain(">0<");
    }
  });

  it("omits empty sections, keeps Help/noAccess and the checklist without workspace access", () => {
    const empty = renderInRouter(
      <HomeView
        t={t}
        workspace={<WorkspaceView t={t} counters={[]} actions={[]} />}
        checklist={<p>checklist-slot</p>}
      />,
    );
    expect(empty).not.toContain("<section");
    expect(empty).toContain(t("home.noAccess"));
    expect(empty).toContain('href="/admin-ui/help"');
    expect(empty.indexOf("checklist-slot")).toBeGreaterThan(empty.indexOf(t("home.noAccess")));
    const actions = renderInRouter(<WorkspaceView t={t} counters={[]} actions={QUICK_ACTIONS} />);
    expect(actions).not.toContain('id="home-counters-title"');
    expect(actions).not.toContain(t("home.noAccess"));
    const counters = renderInRouter(
      <WorkspaceView t={t} counters={[<p key="count">0</p>]} actions={[]} />,
    );
    expect(counters).not.toContain('id="home-actions-title"');
  });

  it("uses Ukrainian labels and names, with a real zero still linked", () => {
    const uk = createTranslator(messagesWith("uk", { home: ukHome }), "uk");
    const html = renderInRouter(
      <CounterView
        t={uk}
        counter={COUNTERS[2]}
        state={{ status: "ready", data: { total: 0 }, reload: noop }}
        total="0"
        onRetry={noop}
      />,
    );
    expect(html).toMatch(/>0<\/span><span[^>]*>Покупці/);
  });
});
