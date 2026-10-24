import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type pg from "pg";
import { vi } from "vitest";
import type { HttpResult } from "./http.js";
import type { Shopper } from "./shopper.js";

/** TEST ONLY. Shipping methods written straight into `shipping_method` (no admin route), removed by `cleanup`. */

export interface TestMethodOptions {
  kind?: "address" | "pickup_point" | "store_pickup";
  pricing?: Record<string, unknown>;
  providerCode?: string | null;
  providerService?: string | null;
  countryCodes?: string[];
  isActive?: boolean;
  title?: Record<string, string>;
  description?: Record<string, string> | null;
  currency?: string;
  position?: number;
}

export interface TestMethod {
  id: string;
  code: string;
}

export class ShippingMethods {
  readonly runId = randomUUID().slice(0, 8);
  private readonly ids: string[] = [];
  private counter = 0;

  constructor(private readonly pool: pg.Pool) {}

  async create(options: TestMethodOptions = {}): Promise<TestMethod> {
    this.counter += 1;
    const code = `m_${this.runId}_${String(this.counter)}`;
    const kind = options.kind ?? "address";
    const result = await this.pool.query<{ id: string }>(
      `insert into shipping_method (code, title, description, kind, provider_code, provider_service, pricing,
                                    currency, country_codes, is_active, position)
       values ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9::text[], $10, $11) returning id`,
      [
        code,
        JSON.stringify(options.title ?? { uk: "Кур'єр", en: "Courier" }),
        options.description === undefined || options.description === null
          ? null
          : JSON.stringify(options.description),
        kind,
        options.providerCode === undefined
          ? kind === "pickup_point"
            ? "fake"
            : null
          : options.providerCode,
        options.providerService ?? null,
        JSON.stringify(options.pricing ?? { type: "flat", amount: 500 }),
        options.currency ?? "UAH",
        options.countryCodes ?? ["UA"],
        options.isActive ?? true,
        options.position ?? this.counter,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("Test setup bug: the method was not inserted");
    }
    this.ids.push(id);
    return { id, code };
  }

  async update(id: string, changes: { pricing?: unknown; isActive?: boolean; title?: unknown }) {
    if (changes.pricing !== undefined) {
      await this.pool.query("update shipping_method set pricing = $2::jsonb where id = $1", [
        id,
        JSON.stringify(changes.pricing),
      ]);
    }
    if (changes.isActive !== undefined) {
      await this.pool.query("update shipping_method set is_active = $2 where id = $1", [
        id,
        changes.isActive,
      ]);
    }
    if (changes.title !== undefined) {
      await this.pool.query("update shipping_method set title = $2::jsonb where id = $1", [
        id,
        JSON.stringify(changes.title),
      ]);
    }
  }

  /** Deletes the methods of this run (orders that used them must be gone first: their snapshots only SET NULL). */
  async cleanup(): Promise<void> {
    await this.pool.query("delete from shipping_method where id = any($1::uuid[])", [
      this.ids.splice(0),
    ]);
  }
}

/** Fails loudly when another spec left an active method behind: a shop "without methods" must really have none. */
export async function expectNoActiveMethods(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from shipping_method where is_active",
  );
  if (result.rows[0]?.count !== 0) {
    throw new Error("Test isolation bug: an active shipping method exists before the spec");
  }
}

export interface ShippingOptionForTest {
  methodCode: string;
  kind: string;
  title: string;
  description: string | null;
  providerCode: string | null;
  countryCodes: string[];
  available: boolean;
  reason?: string;
  price: { amount: number; currency: string } | null;
  payer: string | null;
  total: { amount: number; currency: string } | null;
  estimate: { amount: number; currency: string } | null;
}

export interface ShippingOptionsForTest {
  subtotal: { amount: number; currency: string };
  options: ShippingOptionForTest[];
  code?: string;
}

export function shippingOptions(
  shopper: Shopper,
  query: Record<string, string> = {},
): Promise<HttpResult<ShippingOptionsForTest>> {
  const search = new URLSearchParams(query).toString();
  return shopper.get<ShippingOptionsForTest>(
    `/store/shipping/options${search === "" ? "" : `?${search}`}`,
  );
}

const LOGGER_METHODS = ["log", "warn", "error", "debug", "verbose", "fatal"] as const;

/**
 * Captures everything the API logs (every Logger method and both standard streams) until `stop`. The text is what a log
 * file would hold, so a spec can prove a value never reaches it.
 */
export function captureLogs(): { text: () => string; stop: () => void } {
  const lines: string[] = [];
  const spies = LOGGER_METHODS.map((method) =>
    vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) =>
            arg instanceof Error ? `${arg.message} ${String(arg.stack)}` : String(arg),
          )
          .join(" "),
      );
    }),
  );
  const staticSpies = LOGGER_METHODS.map((method) =>
    vi.spyOn(Logger, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return {
    text: () => lines.join("\n"),
    stop: () => {
      for (const spy of [...spies, ...staticSpies, out, err]) {
        spy.mockRestore();
      }
    },
  };
}
