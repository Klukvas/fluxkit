import {
  createMoney,
  normalizePhone,
  validateAddress,
  validateEmail,
  validatePersonName,
  type Address,
  type Money,
} from "@fluxkit/core";
import { validationFailed, type FieldError } from "../common/problem.js";
import type { CheckoutBody } from "./orders.schemas.js";

export type { CheckoutBody } from "./orders.schemas.js";

/** The checkout request after validation and normalization; everything the rules of core accepted, nothing else. */
export interface CheckoutInput {
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly shippingAddress: Address | null;
  readonly billingAddress: Address | null;
  /** As sent; the service checks it against the configured locales. */
  readonly requestedLocale: string | undefined;
  readonly expectedTotal: Money;
}

function addressErrors(prefix: string, input: unknown): FieldError[] | Address {
  const checked = validateAddress(input);
  if (checked.ok) {
    return checked.address;
  }
  return checked.errors.map(({ field, reason }) => ({
    path: field === "" ? prefix : `${prefix}.${field}`,
    code: reason,
  }));
}

function isErrors(value: FieldError[] | Address): value is FieldError[] {
  return Array.isArray(value);
}

/**
 * The checkout fields judged by the core rules (email, phone, names, addresses, expected total), all errors at once
 * with the path of the field. A signed-in customer may omit the email: the account email is used. Whether a shipping
 * address is needed depends on the cart and is decided in the checkout transaction. The input is not changed.
 */
export function parseCheckoutInput(
  body: CheckoutBody,
  accountEmail: string | undefined,
): CheckoutInput {
  const errors: FieldError[] = [];

  let email = "";
  if (body.email === undefined) {
    if (accountEmail === undefined) {
      errors.push({ path: "email", code: "required" });
    } else {
      email = accountEmail;
    }
  } else {
    const checked = validateEmail(body.email);
    if (checked.ok) {
      email = checked.email;
    } else {
      errors.push({ path: "email", code: checked.reason });
    }
  }

  let phone = "";
  const phoneResult = normalizePhone(body.phone);
  if (phoneResult.ok) {
    phone = phoneResult.phone;
  } else {
    errors.push({ path: "phone", code: phoneResult.reason });
  }

  let firstName = "";
  const firstNameResult = validatePersonName(body.firstName);
  if (firstNameResult.ok) {
    firstName = firstNameResult.name;
  } else {
    errors.push({ path: "firstName", code: firstNameResult.reason });
  }

  let lastName = "";
  const lastNameResult = validatePersonName(body.lastName);
  if (lastNameResult.ok) {
    lastName = lastNameResult.name;
  } else {
    errors.push({ path: "lastName", code: lastNameResult.reason });
  }

  let shippingAddress: Address | null = null;
  if (body.shippingAddress !== undefined && body.shippingAddress !== null) {
    const checked = addressErrors("shippingAddress", body.shippingAddress);
    if (isErrors(checked)) {
      errors.push(...checked);
    } else {
      shippingAddress = checked;
    }
  }
  let billingAddress: Address | null = null;
  if (body.billingAddress !== undefined && body.billingAddress !== null) {
    const checked = addressErrors("billingAddress", body.billingAddress);
    if (isErrors(checked)) {
      errors.push(...checked);
    } else {
      billingAddress = checked;
    }
  }

  let expectedTotal: Money = { amount: 0, currency: "UAH" };
  const money = createMoney(body.expectedTotal.amount, body.expectedTotal.currency);
  if (!money.ok) {
    errors.push({
      path:
        money.reason === "unsupported_currency" ? "expectedTotal.currency" : "expectedTotal.amount",
      code: money.reason,
    });
  } else if (money.money.amount < 0) {
    errors.push({ path: "expectedTotal.amount", code: "negative_amount" });
  } else {
    expectedTotal = money.money;
  }

  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  return {
    email,
    phone,
    firstName,
    lastName,
    shippingAddress,
    billingAddress,
    requestedLocale: body.locale,
    expectedTotal,
  };
}
