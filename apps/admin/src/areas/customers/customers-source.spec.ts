import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the customers area's source for the rules a static-markup test cannot see (plan step 9: never optimistic,
 * never auto-retried, one confirmation, ids only in URLs, a debounced search). They read the files as text, so each rule
 * is pinned to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */

const directory = import.meta.dirname;
const sources = readdirSync(directory)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(directory, name), "utf8") }));
const source = (name: string) => sources.find((file) => file.name === name)?.text ?? "";
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");

describe("customers area source guards", () => {
  it("finds the sources it guards", () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(source("customer-detail-page.tsx")).not.toBe("");
  });

  it("calls the two write operations only from the detail page, once each", () => {
    for (const file of sources) {
      const writesHere = [
        ...code(file.text).matchAll(/adminClient\.(updateCustomer|unlockCustomer)\(/g),
      ];
      expect(writesHere.length, file.name).toBe(file.name === "customer-detail-page.tsx" ? 2 : 0);
    }
    const page = code(source("customer-detail-page.tsx"));
    expect(page.match(/adminClient\.updateCustomer\(/g)).toHaveLength(1);
    expect(page.match(/adminClient\.unlockCustomer\(/g)).toHaveLength(1);
  });

  it("sends every write once through the single flight and runWrite, never in a loop or after a timer", () => {
    const page = code(source("customer-detail-page.tsx"));
    expect(page).toContain("flight.run(() => runWrite(write))");
    expect(page.match(/\bsend\(action, \(\) => adminClient\./g)).toHaveLength(2);
    for (const file of sources) {
      expect(code(file.text), file.name).not.toMatch(
        /\bsetTimeout\b|\bsetInterval\b|\bretry\b|\bwhile\s*\(|\bfor\s*\(|\.catch\(/i,
      );
    }
  });

  it("reads the customer again after every answer (nothing optimistic)", () => {
    const page = code(source("customer-detail-page.tsx"));
    const send = page.slice(page.indexOf("async function send"), page.indexOf("function perform"));
    expect(send).toContain("resource.reload();");
    // The reload comes after the notice for ok, refused and unknown alike: one reload, after the branches.
    expect(send.indexOf("resource.reload();")).toBeGreaterThan(send.lastIndexOf("announce("));
    expect(page).not.toMatch(/setCustomer|optimistic/i);
  });

  it("asks for a confirmation before deactivating, and for none before activating or unlocking", () => {
    const page = code(source("customer-detail-page.tsx"));
    expect(page).toMatch(
      /if \(action === "deactivate"\) setConfirming\(true\);\s*else perform\(action\);/,
    );
    expect(page.match(/perform\("deactivate"\)/g)).toHaveLength(1);
    expect(page).toMatch(/onConfirm=\{\(\) => perform\("deactivate"\)\}/);
  });

  it("checks the offered actions again before sending, so a stale click sends nothing else", () => {
    const page = code(source("customer-detail-page.tsx"));
    expect(page).toMatch(/if \(!actions\.includes\(action\)\) return;/);
  });

  it("puts only ids into links: never an email, a name or a phone", () => {
    for (const file of sources) {
      for (const call of code(file.text).matchAll(
        /\b(customerHref|customerOrdersHref)\(([^)]*)\)/g,
      )) {
        if (call[0].startsWith("customerHref(id") || call[0].startsWith("customerOrdersHref(id"))
          continue;
        expect(call[2], `${file.name}: ${call[0]}`).toMatch(/^(row|customer)\.id$/);
      }
    }
    const view = code(source("customer-view.ts"));
    const links = view.slice(view.indexOf("export function customerHref"));
    expect(links).toContain("customerOrdersHref");
    expect(links).not.toMatch(/email|firstName|lastName|phone/);
  });

  it("applies the search through the 300 ms debounce, replacing the history entry while typing", () => {
    const page = code(source("customer-list-page.tsx"));
    expect(page).toContain("createDebounce(SEARCH_DEBOUNCE_MS)");
    expect(page).toContain("debounce.schedule(() => applySearch(result.value, true))");
    expect(page).toContain("checkCustomerSearch(");
  });

  it("never logs, and never renders raw HTML", () => {
    for (const file of sources) {
      expect(code(file.text), file.name).not.toMatch(/\bconsole\./);
      expect(file.text, file.name).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it("imports no other area, so it loads only its own messages", () => {
    for (const file of sources) {
      expect(file.text, file.name).not.toMatch(
        /from "\.\.\/(orders|products|users|catalog-dictionaries|account|auth|home)\//,
      );
    }
  });
});
