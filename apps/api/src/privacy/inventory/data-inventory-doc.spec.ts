import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { coreInventory } from "./index.js";
import type { ColumnEntry, Inventory } from "./types.js";

// Fails when docs/privacy/data-inventory.md is stale. Regenerate with:
//   UPDATE_PRIVACY_DOC=1 pnpm --filter @fluxkit/api exec vitest run src/privacy/inventory/data-inventory-doc.spec.ts
const DOC_URL = new URL("../../../../../docs/privacy/data-inventory.md", import.meta.url);

/**
 * Purpose and retention per plan row (`docs/plans/2026-10-29-privacy.md`, "Data inventory", "Retention today"). The
 * registry classifies columns but holds neither; this table is the one place the generated document takes them from.
 * Legal bases are proposals: C contract, L legal obligation, LI legitimate interest.
 */
const ROW_FACTS: Readonly<Record<string, { purpose: string; retention: string }>> = {
  D1: {
    purpose: "Account (C)",
    retention: "Until the account is deleted; inactive accounts are not purged",
  },
  D2: { purpose: "Account security (LI)", retention: "As D1" },
  D3: {
    purpose: "Customer sign-in (C)",
    retention: "Job 6 removes a session at its absolute end (default 90 days)",
  },
  D4: {
    purpose: "Password reset and email verification (C)",
    retention: "Job 10: 30 days after expiry",
  },
  D5: { purpose: "Cart (C)", retention: "Job 5: `CART_TTL_DAYS` (default 30)" },
  D6: {
    purpose: "Order, delivery, support (C); accounting (L)",
    retention:
      "Until `ORDER_CONTACT_RETENTION_DAYS` when set (job 12), else forever; erased on request",
  },
  D7: { purpose: "Delivery (C)", retention: "As D6" },
  D8: { purpose: "Accounting record (L)", retention: "Forever (accounting record)" },
  D9: {
    purpose: "Guest order access, checkout replay (C)",
    retention: "Forever as hashes; guest access ends after `ORDER_GUEST_ACCESS_DAYS` (default 90)",
  },
  D10: { purpose: "Order handling (C, L)", retention: "As D6" },
  D11: { purpose: "Accounting record (L)", retention: "Forever, immutable" },
  D12: { purpose: "Order journal (C, L)", retention: "Forever, append-only" },
  D13: { purpose: "Delivery (C)", retention: "Forever" },
  D14: { purpose: "Payment and refunds (C, L)", retention: "Forever" },
  D15: { purpose: "Payment journal (L)", retention: "Forever" },
  D16: { purpose: "Mail delivery (C)", retention: "Job 10: 30 days (`failed`, `unknown`: 90)" },
  D17: { purpose: "Event outbox (C)", retention: "Job 4: 7 days after dispatch" },
  D18: { purpose: "Staff access (LI)", retention: "Forever (deactivate only)" },
  D19: {
    purpose: "Staff sign-in",
    retention: "Removed after expiry by the expired-session cleanup",
  },
  D20: {
    purpose: "Accountability (LI)",
    retention: "Forever; set to NULL when the admin user is deleted",
  },
  D21: { purpose: "Inventory journal", retention: "Forever, append-only" },
  D22: { purpose: "Sending parcels (C, LI)", retention: "Until the owner changes it" },
  D23: { purpose: "Catalog images", retention: "Job 7 removes abandoned uploads" },
  D24: {
    purpose: "No personal data (catalog, pricing, inventory, shipping methods, search, health)",
    retention: "Not applicable",
  },
  D25: {
    purpose: "Accountability (L, LI)",
    retention:
      "Requests 1095 days after completion, audit events 365 days; only when `ORDER_CONTACT_RETENTION_DAYS` is set (job 12)",
  },
};

const CLASS_LABELS: Readonly<Record<ColumnEntry["class"], string>> = {
  personal: "personal (P)",
  pseudonymous: "pseudonymous (Q)",
  staff: "staff (S)",
  secret_hash: "secret hash (H)",
  free_text: "free text (F)",
  none: "none",
};

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function rowNumber(ref: string): number {
  return Number(ref.slice(1));
}

interface Group {
  readonly columns: string[];
  readonly entry: ColumnEntry;
}

/** Consecutive columns of one table with identical classification share a row. */
function groupColumns(columns: Readonly<Record<string, ColumnEntry>>): Group[] {
  const groups: Group[] = [];
  for (const [name, entry] of Object.entries(columns)) {
    const same = groups.find(
      (group) =>
        group.entry.class === entry.class &&
        group.entry.ref === entry.ref &&
        group.entry.export === entry.export &&
        group.entry.erasure === entry.erasure &&
        group.entry.reason === entry.reason,
    );
    if (same === undefined) groups.push({ columns: [name], entry });
    else same.columns.push(name);
  }
  return groups;
}

function renderDataInventory(inventory: Inventory): string {
  const tables = Object.keys(inventory).sort((a, b) => a.localeCompare(b));
  const refs = new Set<string>();
  const lines: string[] = [
    "# Data inventory",
    "",
    "<!-- Generated from apps/api/src/privacy/inventory by data-inventory-doc.spec.ts. Do not edit by hand: run the command below. -->",
    "",
    'Every database column of the core schema with its class, purpose, retention and what an export and an erasure do with it. The source is code: `apps/api/src/privacy/inventory/` (the registry) and, for purpose and retention, the plan rows named in the Row column (`docs/plans/2026-10-29-privacy.md`, "Data inventory"). A spec fails when this file and the registry disagree.',
    "",
    "Regenerate after changing the registry: `UPDATE_PRIVACY_DOC=1 pnpm --filter @fluxkit/api exec vitest run src/privacy/inventory/data-inventory-doc.spec.ts`.",
    "",
    "Classes: personal (P) identifies a person directly; pseudonymous (Q) identifies through another table or a third party; staff (S) is staff personal data; secret hash (H) is not personal by itself but linkable; free text (F) is admin text that MAY contain personal data; none holds no personal data. Export: `included`, `excluded` (with a reason), `not_applicable`. Erasure: `delete_row`, `cascade`, `anonymise`, `set_null`, `clear`, `keep`, `out_of_scope`, `not_applicable`.",
    "",
    "Purposes and legal bases are proposals taken from the plan. TODO(fluxkit): legal review of the purposes, bases and retention periods (plan tasks O3, O5).",
    "",
    "## Tables and columns",
    "",
    "| Table | Columns | Class | Row | Export | Erasure | Reason |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const table of tables) {
    const columns = inventory[table] ?? {};
    const names = Object.keys(columns);
    const entries = Object.values(columns);
    const allNone = entries.length > 0 && entries.every((entry) => entry.class === "none");
    if (allNone) {
      const first = entries[0] as ColumnEntry;
      refs.add(first.ref);
      lines.push(
        `| \`${table}\` | all ${names.length} columns | none | ${first.ref} | not_applicable | not_applicable | |`,
      );
      continue;
    }
    for (const group of groupColumns(columns)) {
      refs.add(group.entry.ref);
      lines.push(
        `| \`${table}\` | ${group.columns.map((name) => `\`${name}\``).join(", ")} | ${CLASS_LABELS[group.entry.class]} | ${group.entry.ref} | ${group.entry.export} | ${group.entry.erasure} | ${cell(group.entry.reason ?? "")} |`,
      );
    }
  }
  lines.push(
    "",
    "## Rows: purpose and retention",
    "",
    "| Row | Purpose (basis) | Retention |",
    "|---|---|---|",
  );
  for (const ref of [...refs].sort((a, b) => rowNumber(a) - rowNumber(b))) {
    const facts = ROW_FACTS[ref];
    lines.push(
      `| ${ref} | ${facts === undefined ? "MISSING" : cell(facts.purpose)} | ${facts === undefined ? "MISSING" : cell(facts.retention)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

describe("docs/privacy/data-inventory.md", () => {
  it("has a purpose and retention for every row the registry uses", () => {
    const refs = new Set(
      Object.values(coreInventory).flatMap((columns) =>
        Object.values(columns).map((entry) => entry.ref),
      ),
    );
    expect([...refs].filter((ref) => ROW_FACTS[ref] === undefined)).toEqual([]);
  });

  it("matches the registry", async () => {
    const rendered = renderDataInventory(coreInventory);
    if (process.env["UPDATE_PRIVACY_DOC"] === "1") await writeFile(DOC_URL, rendered, "utf8");
    const committed = await readFile(DOC_URL, "utf8");
    expect(committed, "stale: run with UPDATE_PRIVACY_DOC=1 (see the header of this spec)").toBe(
      rendered,
    );
  });

  it("renders a different document when a column class changes", () => {
    const table = Object.keys(coreInventory)[0] as string;
    const column = Object.keys(coreInventory[table] ?? {})[0] as string;
    const entry = coreInventory[table]?.[column] as ColumnEntry;
    const mutated: Inventory = {
      ...coreInventory,
      [table]: {
        ...coreInventory[table],
        [column]: { ...entry, class: entry.class === "personal" ? "none" : "personal" },
      },
    };
    expect(renderDataInventory(mutated)).not.toBe(renderDataInventory(coreInventory));
  });
});
