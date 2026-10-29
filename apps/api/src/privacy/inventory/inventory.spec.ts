import { describe, expect, it } from "vitest";
import { ORDER_ANONYMISATION_PLAN, ORDER_COLUMNS_KEPT_ON_ANONYMISATION } from "@fluxkit/core";
import { checkInventory, coreInventory, listSchemaTables } from "./index.js";
import type { ColumnEntry, Inventory, SchemaTable } from "./types.js";

const schemaTables = listSchemaTables();

function withEntry(table: string, column: string, entry: ColumnEntry): Inventory {
  return { ...coreInventory, [table]: { ...coreInventory[table], [column]: entry } };
}

function withoutColumn(table: string, column: string): Inventory {
  const rest = Object.fromEntries(
    Object.entries(coreInventory[table] ?? {}).filter(([name]) => name !== column),
  );
  return { ...coreInventory, [table]: rest };
}

function withoutReason(entry: ColumnEntry): ColumnEntry {
  return { class: entry.class, ref: entry.ref, export: entry.export, erasure: entry.erasure };
}

function entryOf(table: string, column: string): ColumnEntry {
  const entry = coreInventory[table]?.[column];
  if (entry === undefined) throw new Error(`no inventory entry for ${table}.${column}`);
  return entry;
}

describe("the core inventory against the Drizzle schema", () => {
  it("classifies every table and column and nothing else", () => {
    expect(checkInventory(coreInventory, schemaTables)).toEqual([]);
  });

  it("sees the schema (a guard over an empty list would pass for the wrong reason)", () => {
    expect(schemaTables.length).toBeGreaterThan(40);
    expect(schemaTables.map((table) => table.name)).toContain("sales_order");
  });

  it("classifies the contact columns of the customer and the order as personal with an erasure action", () => {
    for (const column of ["email", "first_name", "last_name", "phone"]) {
      expect(entryOf("customer", column)).toMatchObject({
        class: "personal",
        erasure: "delete_row",
      });
    }
    for (const column of [
      "email",
      "phone",
      "first_name",
      "last_name",
      "shipping_address",
      "billing_address",
    ]) {
      expect(entryOf("sales_order", column)).toMatchObject({
        class: "personal",
        export: "included",
        erasure: "anonymise",
      });
    }
  });

  it("clears the guest access and replaces the request fingerprint of an erased order", () => {
    expect(entryOf("sales_order", "access_token_hash").erasure).toBe("clear");
    expect(entryOf("sales_order", "access_expires_at").erasure).toBe("clear");
    expect(entryOf("sales_order", "request_fingerprint").erasure).toBe("anonymise");
    expect(entryOf("sales_order", "cancellation_reason").erasure).toBe("anonymise");
  });

  it("never exports a hash", () => {
    for (const [table, columns] of Object.entries(coreInventory)) {
      for (const [column, entry] of Object.entries(columns)) {
        if (entry.class === "secret_hash") {
          expect(entry.export, `${table}.${column}`).toBe("excluded");
        }
      }
    }
  });

  it("keeps no personal column, and anonymises or deletes the order and account contact data", () => {
    for (const [table, columns] of Object.entries(coreInventory)) {
      for (const [column, entry] of Object.entries(columns)) {
        if (entry.class === "personal") {
          expect(entry.erasure, `${table}.${column}`).not.toBe("keep");
        }
      }
    }
  });
});

describe("the inventory against the core anonymisation plan (ADR 0033 decision 6)", () => {
  // `contact_erased_at` is added by the privacy migration (plan step 4); until then it is in the plan only.
  const NOT_YET_IN_SCHEMA = ["contact_erased_at"];
  const planned = ORDER_ANONYMISATION_PLAN.map((step) => step.column).filter(
    (column) => !NOT_YET_IN_SCHEMA.includes(column),
  );

  it("changes exactly the sales_order columns the inventory anonymises or clears", () => {
    const inventoried = Object.entries(coreInventory["sales_order"] ?? {})
      .filter(([, entry]) => entry.erasure === "anonymise" || entry.erasure === "clear")
      .map(([column]) => column);
    expect([...planned].sort()).toEqual(inventoried.sort());
  });

  it("assigns every sales_order column to the plan or to the kept list, and no column to both", () => {
    const columns = schemaTables.find((table) => table.name === "sales_order")?.columns ?? [];
    expect(columns.length).toBeGreaterThan(20);
    for (const column of columns) {
      const inPlan = planned.includes(column);
      const kept = ORDER_COLUMNS_KEPT_ON_ANONYMISATION.includes(column);
      expect(inPlan !== kept, `${column}: plan ${String(inPlan)}, kept ${String(kept)}`).toBe(true);
    }
    for (const column of ORDER_COLUMNS_KEPT_ON_ANONYMISATION) {
      expect(columns, column).toContain(column);
    }
  });

  it("keeps in the plan nothing the inventory calls personal data", () => {
    for (const column of ORDER_COLUMNS_KEPT_ON_ANONYMISATION) {
      expect(coreInventory["sales_order"]?.[column]?.class, column).not.toBe("personal");
    }
  });
});

describe("the inventory guard fires (each rule is proven by a mutated copy)", () => {
  it("fails for a column added to the schema without an entry", () => {
    const extra: SchemaTable[] = schemaTables.map((table) =>
      table.name === "customer"
        ? { ...table, columns: [...table.columns, "date_of_birth"] }
        : table,
    );
    expect(checkInventory(coreInventory, extra)).toEqual([
      "customer.date_of_birth: column has no inventory entry",
    ]);
  });

  it("fails for a table added to the schema without an entry", () => {
    const extra: SchemaTable[] = [...schemaTables, { name: "wishlist", columns: ["id"] }];
    expect(checkInventory(coreInventory, extra)).toEqual([
      "wishlist: table has no inventory entry",
    ]);
  });

  it("fails when an entry is left behind for a removed column or table", () => {
    const column = withEntry("customer", "nickname", entryOf("customer", "first_name"));
    expect(checkInventory(column, schemaTables)).toEqual([
      "customer.nickname: entry for a column that does not exist",
    ]);
    const table = { ...coreInventory, ghost: { id: entryOf("customer", "email") } };
    expect(checkInventory(table, schemaTables)).toEqual([
      "ghost: entry for a table that does not exist",
    ]);
  });

  it("fails when a column is dropped from the inventory", () => {
    expect(checkInventory(withoutColumn("sales_order", "phone"), schemaTables)).toEqual([
      "sales_order.phone: column has no inventory entry",
    ]);
  });

  it("fails for a column named like personal data that is classified none", () => {
    const none: ColumnEntry = {
      class: "none",
      ref: "D24",
      export: "not_applicable",
      erasure: "not_applicable",
    };
    expect(checkInventory(withEntry("customer", "phone", none), schemaTables)).toEqual([
      "customer.phone: a column named like personal data cannot be class none",
    ]);
  });

  it("fails for a personal column that is kept, or has no erasure or export decision", () => {
    const personal = entryOf("customer", "email");
    expect(
      checkInventory(
        withEntry("customer", "email", { ...personal, erasure: "keep", reason: "x" }),
        schemaTables,
      ),
    ).toEqual(["customer.email: a personal column cannot be kept"]);
    expect(
      checkInventory(
        withEntry("customer", "email", { ...personal, erasure: "not_applicable" }),
        schemaTables,
      ),
    ).toEqual(["customer.email: no erasure decision"]);
    expect(
      checkInventory(
        withEntry("customer", "email", { ...personal, export: "not_applicable" }),
        schemaTables,
      ),
    ).toEqual(["customer.email: no export decision"]);
  });

  it("fails for an exported secret hash", () => {
    const hash = entryOf("customer", "password_hash");
    expect(
      checkInventory(
        withEntry("customer", "password_hash", { ...hash, export: "included" }),
        schemaTables,
      ),
    ).toEqual(["customer.password_hash: a secret hash must never be exported"]);
  });

  it("fails for an exclusion or a kept column without a reason", () => {
    const hash = entryOf("customer", "password_hash");
    const noReason = withoutReason(hash);
    expect(checkInventory(withEntry("customer", "password_hash", noReason), schemaTables)).toEqual([
      "customer.password_hash: export excluded, keep or out_of_scope needs a reason",
    ]);
    const kept = entryOf("sales_order", "number");
    const keptWithoutReason = withoutReason(kept);
    expect(
      checkInventory(withEntry("sales_order", "number", keptWithoutReason), schemaTables),
    ).toEqual(["sales_order.number: export excluded, keep or out_of_scope needs a reason"]);
  });

  it("fails for a none column that carries an action", () => {
    const entry: ColumnEntry = { class: "none", ref: "D24", export: "included", erasure: "keep" };
    expect(checkInventory(withEntry("brand", "name", entry), schemaTables)).toEqual([
      "brand.name: class none must have export and erasure not_applicable",
    ]);
  });
});
