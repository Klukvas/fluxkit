import { hasJsonbUnsafeCharacters } from "@fluxkit/core";
import type { FieldError } from "../../common/problem.js";

/*
 * Bounded validation of a provider's non-secret settings (ADR 0029 decisions 7 and 8). `ShippingProviderPort` has no
 * settings validator yet (the Nova Poshta field list is unverified, plan step 7a), so until a provider can say what it
 * accepts the API only guarantees what it must for ANY provider: a plain JSON object of bounded size, depth and key
 * shapes, with no key that looks like a credential (secrets live in the environment only and never reach the database).
 * A provider that needs more (required fields, formats) validates when it uses the settings.
 */

export const PROVIDER_SETTINGS_LIMITS = Object.freeze({
  /** UTF-8 size of the whole object serialized as JSON. */
  maxBytes: 16 * 1024,
  /** Object and array nesting below the top-level object. */
  maxDepth: 4,
  maxKeysPerObject: 50,
  maxArrayItems: 100,
  maxStringLength: 500,
});

/** A key a provider setting may have: letters, digits and `_`, starting with a letter (so `__proto__` never fits). */
export const PROVIDER_SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Names that mean a credential. The check is a guard against a pasted secret, not a promise that nothing secret fits. */
const SECRET_KEY_PATTERN =
  /secret|password|passwd|token|api_?key|credential|private_?key|authorization/i;

type Errors = FieldError[];

function join(path: string, segment: string | number): string {
  return path === "" ? String(segment) : `${path}.${String(segment)}`;
}

function checkValue(value: unknown, path: string, depth: number, errors: Errors): void {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      errors.push({ path, code: "not_finite" });
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > PROVIDER_SETTINGS_LIMITS.maxStringLength) {
      errors.push({ path, code: "too_long" });
    } else if (hasJsonbUnsafeCharacters(value)) {
      errors.push({ path, code: "unsafe_text" });
    }
    return;
  }
  if (depth >= PROVIDER_SETTINGS_LIMITS.maxDepth) {
    errors.push({ path, code: "too_deep" });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > PROVIDER_SETTINGS_LIMITS.maxArrayItems) {
      errors.push({ path, code: "too_many_items" });
      return;
    }
    value.forEach((item: unknown, index) => {
      checkValue(item, join(path, index), depth + 1, errors);
    });
    return;
  }
  if (typeof value === "object") {
    checkObject(value as Record<string, unknown>, path, depth + 1, errors);
    return;
  }
  errors.push({ path, code: "invalid_type" });
}

function checkObject(
  value: Readonly<Record<string, unknown>>,
  path: string,
  depth: number,
  errors: Errors,
): void {
  const keys = Object.keys(value);
  if (keys.length > PROVIDER_SETTINGS_LIMITS.maxKeysPerObject) {
    errors.push({ path, code: "too_many_keys" });
    return;
  }
  for (const key of keys) {
    const at = join(path, key);
    if (!PROVIDER_SETTING_KEY_PATTERN.test(key)) {
      errors.push({ path: at, code: "invalid_key" });
    } else if (SECRET_KEY_PATTERN.test(key)) {
      errors.push({ path: at, code: "secret_not_allowed" });
    } else {
      checkValue(value[key], at, depth, errors);
    }
  }
}

/** Errors of `settings` (paths relative to it; empty for the object itself). Empty array = acceptable. */
export function providerSettingsErrors(settings: unknown): Errors {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return [{ path: "", code: "not_an_object" }];
  }
  const errors: Errors = [];
  checkObject(settings as Record<string, unknown>, "", 0, errors);
  if (errors.length === 0) {
    const bytes = Buffer.byteLength(JSON.stringify(settings), "utf8");
    if (bytes > PROVIDER_SETTINGS_LIMITS.maxBytes) {
      errors.push({ path: "", code: "too_large" });
    }
  }
  return errors;
}
