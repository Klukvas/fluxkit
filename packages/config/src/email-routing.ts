import {
  EMAIL_PROVIDER_CHOICES,
  TEST_ONLY_EMAIL_PROVIDERS,
  type EmailProviderChoice,
} from "./email.js";

export interface EmailUsageLimit {
  readonly daily: number | null;
  readonly monthly: number | null;
}

/** Operator-configured caps, never an account's actual remaining balance. */
export type EmailUsageLimits = Readonly<Record<string, EmailUsageLimit>>;

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

/** Strict validation happens before the package loader can deduplicate its enabled list. */
export function parseEmailFallbackProviders(
  raw: string | undefined,
  primary: EmailProviderChoice,
): Parsed<string[]> {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: [] };
  const codes = raw.split(",").map((code) => code.trim().toLowerCase());
  if (primary === "none") return { ok: false, problem: "requires EMAIL_PROVIDER other than none" };
  if (codes.some((code) => code === ""))
    return { ok: false, problem: "must not contain empty entries" };
  if (
    codes.some(
      (code) => code === "none" || !EMAIL_PROVIDER_CHOICES.some((choice) => choice === code),
    )
  ) {
    return { ok: false, problem: "must contain installed email provider codes other than none" };
  }
  if (new Set(codes).size !== codes.length)
    return { ok: false, problem: "must not contain duplicate providers" };
  if (codes.includes(primary)) return { ok: false, problem: "must not repeat EMAIL_PROVIDER" };
  return { ok: true, value: codes };
}

const MAX_USAGE_LIMITS_LENGTH = 8192;
const INVALID_USAGE =
  "must be a bounded JSON object of installed provider codes with daily and monthly positive safe integer or null limits";

/** All errors are fixed text: JSON keys, parser diagnostics and values may carry secrets. */
export function parseEmailUsageLimits(raw: string | undefined): Parsed<EmailUsageLimits> {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: {} };
  if (raw.length > MAX_USAGE_LIMITS_LENGTH) return { ok: false, problem: INVALID_USAGE };
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, problem: INVALID_USAGE };
  }
  if (hasDuplicateKeys(raw)) return { ok: false, problem: INVALID_USAGE };
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, problem: INVALID_USAGE };
  const entries = Object.entries(input);
  if (entries.length > EMAIL_PROVIDER_CHOICES.length - 1)
    return { ok: false, problem: INVALID_USAGE };
  const checked: [string, EmailUsageLimit][] = [];
  for (const [code, limits] of entries) {
    if (code === "none" || !EMAIL_PROVIDER_CHOICES.some((choice) => choice === code))
      return { ok: false, problem: INVALID_USAGE };
    if (typeof limits !== "object" || limits === null || Array.isArray(limits))
      return { ok: false, problem: INVALID_USAGE };
    const fields = Object.keys(limits);
    const values = limits as Record<string, unknown>;
    if (fields.length !== 2 || !fields.includes("daily") || !fields.includes("monthly"))
      return { ok: false, problem: INVALID_USAGE };
    const valid = (value: unknown): value is number | null =>
      value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
    if (!valid(values["daily"]) || !valid(values["monthly"]))
      return { ok: false, problem: INVALID_USAGE };
    checked.push([code, { daily: values["daily"], monthly: values["monthly"] }]);
  }
  return { ok: true, value: Object.fromEntries(checked) };
}

/** JSON.parse intentionally overwrites repeated keys; configuration must reject that ambiguity. */
function hasDuplicateKeys(raw: string): boolean {
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|[^\s{}[\]:,]+/g) ?? [];
  const objects: (Set<string> | null)[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "{") objects.push(new Set());
    else if (token === "[") objects.push(null);
    else if (token === "}" || token === "]") objects.pop();
    else if (token?.startsWith('"') === true && tokens[index + 1] === ":") {
      const object = objects[objects.length - 1];
      const key = JSON.parse(token) as string;
      if (object?.has(key) === true) return true;
      object?.add(key);
    }
  }
  return false;
}

export function emailRoutingValues(
  primary: EmailProviderChoice,
  fallbacks: string | undefined,
  limits: string | undefined,
): { emailFallbackProviders: string[]; emailUsageLimits: EmailUsageLimits } {
  const parsedFallbacks = parseEmailFallbackProviders(fallbacks, primary);
  const parsedLimits = parseEmailUsageLimits(limits);
  if (!parsedFallbacks.ok || !parsedLimits.ok)
    throw new Error("Email routing variables were not validated.");
  return { emailFallbackProviders: parsedFallbacks.value, emailUsageLimits: parsedLimits.value };
}

/** Redacted issues shared by the environment schema; no raw setting becomes an issue path. */
export function emailRoutingIssues(
  primary: EmailProviderChoice,
  fallbacks: string | undefined,
  limits: string | undefined,
  production: boolean,
): { code: "custom"; path: string[]; message: string }[] {
  const selected = parseEmailFallbackProviders(fallbacks, primary);
  const parsedLimits = parseEmailUsageLimits(limits);
  return [
    ...(!selected.ok
      ? [{ code: "custom" as const, path: ["EMAIL_FALLBACK_PROVIDERS"], message: selected.problem }]
      : []),
    ...(!parsedLimits.ok
      ? [{ code: "custom" as const, path: ["EMAIL_USAGE_LIMITS"], message: parsedLimits.problem }]
      : []),
    ...(production &&
    selected.ok &&
    selected.value.some((code) => TEST_ONLY_EMAIL_PROVIDERS.includes(code))
      ? [
          {
            code: "custom" as const,
            path: ["EMAIL_FALLBACK_PROVIDERS"],
            message: "test-only providers are refused when NODE_ENV is production",
          },
        ]
      : []),
  ];
}
