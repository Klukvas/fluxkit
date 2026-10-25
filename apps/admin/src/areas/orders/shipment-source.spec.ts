import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the shipment section's wiring that a static-markup test cannot see (the decisions are tested in
 * `shipment-view.spec.ts` and `shipment-outcome.spec.ts`). They read the files as text, so each rule is pinned to the shape of
 * the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");
const read = (name: string) => strip(readFileSync(join(import.meta.dirname, name), "utf8"));
const section = read("shipment-section.tsx");

describe("shipment section source guards", () => {
  it("sends every write through the single flight and runWrite, once", () => {
    expect(section).toContain("const running = flight.run(() => runWrite(write));");
    expect(section).toContain("if (running === null) return null;");
    const calls = [...section.matchAll(/adminClient\.(\w+)\(/g)].map((match) => match[1]);
    expect(calls.sort()).toEqual(
      [
        "cancelShipment",
        "createShipment",
        "getShipmentLabel",
        "reconcileShipment",
        "refreshShipment",
      ].sort(),
    );
    for (const match of section.matchAll(/adminClient\.\w+\(/g)) {
      const before = section.slice(Math.max(0, match.index - 60), match.index);
      expect(before, match[0]).toMatch(/send\(\(\) =>|\? |: $|=>\s*$/);
    }
  });

  it("never retries or repeats a write: no timer, loop or second create", () => {
    expect(section).not.toMatch(/setTimeout|setInterval|while \(|retry\(/);
    expect(section.match(/adminClient\.createShipment\(/g)).toHaveLength(1);
  });

  it("reads the order again after every answer of a write", () => {
    expect(section.match(/onChanged\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("hands the label to the browser as a download, never by navigating to the API", () => {
    expect(section).toContain(
      "downloadBlob(outcome.data, labelFileName(order.number), browserDownloadEnvironment())",
    );
    expect(section).not.toMatch(/window\.open|location|href=/);
    const download = read("label-download.ts");
    expect(download).toContain("URL.createObjectURL");
    expect(download).toContain("URL.revokeObjectURL");
    expect(download).not.toMatch(/window\.open|location|fetch\(/);
  });

  it("confirms the cancel before sending it", () => {
    expect(section).toContain("setCancelling(shipment)");
    const direct = section.slice(
      section.indexOf("function onAction"),
      section.indexOf("async function confirmCancel"),
    );
    expect(direct).not.toContain("cancelShipment");
  });

  it("keeps the create form behind the gate: nothing is sent unless the order is ready", () => {
    expect(section).toMatch(/if \(gate\.kind !== "ready"\) return;/);
  });
});
