import type { AdminShippingPricing } from "@fluxkit/api-client";
import { amountToInputText, parseMoneyInput } from "../../lib/money-input";
import { issue, type FormIssues } from "../catalog-dictionaries/form-rules";

/**
 * The pricing part of the shipping method form (ADR 0029 decision 3; `docs/api/shipping.md`). The admin types DECIMAL text
 * (`80.50`); the request holds integer minor units, converted by `parseMoneyInput` (BigInt on the digits, never a float)
 * with the exponent of the shop currency from `GET /admin/config`. The rules repeat core's `validateShippingPricing` for
 * early feedback (the server stays the authority and its reasons land on the same field paths: `pricing.amount`,
 * `pricing.tiers.2.fromSubtotal`). Pure; the screens only render it.
 */

export const PRICING_TYPES = ["flat", "free_over", "tiers", "carrier_on_delivery"] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

/** Core's `SHIPPING_LIMITS.maxTiers` (copied: the SPA does not bundle core; the spec compares behaviour with core). */
export const MAX_TIERS = 20;

export interface TierValues {
  fromSubtotal: string;
  amount: string;
}

/** Every field of every type, so switching the type keeps what was typed; only the chosen type's fields are sent. */
export interface PricingValues {
  type: PricingType;
  amount: string;
  freeFrom: string;
  tiers: TierValues[];
}

export function emptyPricingValues(type: PricingType = "flat"): PricingValues {
  return { type, amount: "", freeFrom: "", tiers: [{ fromSubtotal: "0", amount: "" }] };
}

/** The editable text of a stored pricing; each amount shown with the currency's exponent. */
export function pricingValuesFrom(pricing: AdminShippingPricing, exponent: number): PricingValues {
  const text = (amount: number) => amountToInputText(amount, exponent);
  const base = emptyPricingValues(pricing.type);
  switch (pricing.type) {
    case "flat":
      return { ...base, amount: text(pricing.amount) };
    case "free_over":
      return { ...base, amount: text(pricing.amount), freeFrom: text(pricing.freeFrom) };
    case "tiers":
      return {
        ...base,
        tiers: pricing.tiers.map((tier) => ({
          fromSubtotal: text(tier.fromSubtotal),
          amount: text(tier.amount),
        })),
      };
    case "carrier_on_delivery":
      return base;
  }
}

export type PricingResult =
  { ok: true; pricing: AdminShippingPricing } | { ok: false; issues: FormIssues };

function money(
  text: string,
  exponent: number,
  path: string,
  found: FormIssues,
): number | undefined {
  const parsed = parseMoneyInput(text, exponent);
  if (parsed.ok) return parsed.amount;
  found[path] = issue(
    `ship.money.${parsed.reason}`,
    parsed.reason === "too_many_decimals" ? { decimals: exponent } : undefined,
  );
  return undefined;
}

/**
 * The request `pricing` of the typed values, or the issues by field path. Only the chosen type's fields are read, so text
 * left in the fields of another type never reaches the request.
 */
export function pricingFromValues(values: PricingValues, exponent: number): PricingResult {
  const found: FormIssues = {};
  switch (values.type) {
    case "carrier_on_delivery":
      return { ok: true, pricing: { type: "carrier_on_delivery" } };
    case "flat": {
      const amount = money(values.amount, exponent, "pricing.amount", found);
      return amount === undefined
        ? { ok: false, issues: found }
        : { ok: true, pricing: { type: "flat", amount } };
    }
    case "free_over": {
      const amount = money(values.amount, exponent, "pricing.amount", found);
      const freeFrom = money(values.freeFrom, exponent, "pricing.freeFrom", found);
      return amount === undefined || freeFrom === undefined
        ? { ok: false, issues: found }
        : { ok: true, pricing: { type: "free_over", amount, freeFrom } };
    }
    case "tiers": {
      if (values.tiers.length === 0) {
        return { ok: false, issues: { "pricing.tiers": issue("ship.reason.no_tiers") } };
      }
      if (values.tiers.length > MAX_TIERS) {
        return { ok: false, issues: { "pricing.tiers": issue("ship.reason.too_many_tiers") } };
      }
      const parsed = values.tiers.map((tier, index) => ({
        fromSubtotal: money(
          tier.fromSubtotal,
          exponent,
          `pricing.tiers.${String(index)}.fromSubtotal`,
          found,
        ),
        amount: money(tier.amount, exponent, `pricing.tiers.${String(index)}.amount`, found),
      }));
      // Like core: the order rules run only once every tier can be read.
      if (Object.keys(found).length > 0) return { ok: false, issues: found };
      const tiers = parsed.map((tier) => ({
        fromSubtotal: tier.fromSubtotal as number,
        amount: tier.amount as number,
      }));
      tiers.forEach((tier, index) => {
        const path = `pricing.tiers.${String(index)}.fromSubtotal`;
        const previous = tiers[index - 1];
        if (previous === undefined) {
          if (tier.fromSubtotal !== 0) found[path] = issue("ship.reason.first_tier_not_zero");
        } else if (tier.fromSubtotal === previous.fromSubtotal) {
          found[path] = issue("ship.reason.duplicate_tier");
        } else if (tier.fromSubtotal < previous.fromSubtotal) {
          found[path] = issue("ship.reason.tiers_not_sorted");
        }
      });
      return Object.keys(found).length > 0
        ? { ok: false, issues: found }
        : { ok: true, pricing: { type: "tiers", tiers } };
    }
  }
}
