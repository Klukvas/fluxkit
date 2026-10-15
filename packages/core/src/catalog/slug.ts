import { TEXT_LIMITS } from "./limits.js";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SlugValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "empty" | "too_long" | "invalid_format" };

export function validateSlug(slug: string): SlugValidationResult {
  if (slug.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (slug.length > TEXT_LIMITS.slug) {
    return { ok: false, reason: "too_long" };
  }
  return SLUG_PATTERN.test(slug) ? { ok: true } : { ok: false, reason: "invalid_format" };
}

export function isValidSlug(slug: string): boolean {
  return validateSlug(slug).ok;
}

// Official Ukrainian romanization, Resolution of the Cabinet of Ministers of Ukraine
// No. 55 of 27 January 2010. The five letters whose result depends on the position in the word
// are listed in `POSITIONAL`; the soft sign and apostrophes produce nothing.
const SIMPLE: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "h",
  ґ: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "y",
  і: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
};

const POSITIONAL: Readonly<Record<string, { readonly initial: string; readonly inner: string }>> = {
  є: { initial: "ye", inner: "ie" },
  ї: { initial: "yi", inner: "i" },
  й: { initial: "y", inner: "i" },
  ю: { initial: "yu", inner: "iu" },
  я: { initial: "ya", inner: "ia" },
};

const APOSTROPHES = new Set(["'", "’", "ʼ", "`", "´", "‘"]);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Romanizes Ukrainian text with the KMU 55/2010 table: `зг` becomes `zgh`, `є ю я ї й` differ at
 * the start of a word, the soft sign and apostrophes are dropped. A multi-letter result of a capital
 * letter gets a capital first letter only. Everything that is not Ukrainian Cyrillic is kept as is.
 */
export function transliterateUkrainian(text: string): string {
  let result = "";
  let previous = "";
  for (const char of text.normalize("NFC")) {
    const lower = char.toLowerCase();
    const isUpper = char !== lower;
    const atWordStart = previous === "" || !(/\p{L}/u.test(previous) || APOSTROPHES.has(previous));
    let output: string | undefined;
    if (APOSTROPHES.has(char) || lower === "ь") {
      output = "";
    } else if (lower === "г" && previous.toLowerCase() === "з") {
      output = "gh";
    } else {
      const positional = POSITIONAL[lower];
      output = positional !== undefined ? (atWordStart ? positional.initial : positional.inner) : SIMPLE[lower];
    }
    result += output === undefined ? char : isUpper ? capitalize(output) : output;
    previous = char;
  }
  return result;
}

/**
 * Builds a slug from a title: romanize, drop accents, lowercase, collapse everything that is not
 * `a-z0-9` into one hyphen. May return an empty string. Cyrillic letters outside the Ukrainian
 * alphabet (for example `ы`, `э`, `ъ`, `ё`) are not romanized and act as separators.
 */
export function slugify(title: string): string {
  const slug = transliterateUkrainian(title)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateSlug(slug, TEXT_LIMITS.slug);
}

function truncateSlug(slug: string, maxLength: number): string {
  return slug.slice(0, maxLength).replace(/-+$/, "");
}

export type GenerateSlugResult =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly reason: "empty_slug" };

/** Slugifies the title and appends `-2`, `-3`, ... until the slug is not in `takenSlugs`. */
export function generateUniqueSlug(
  title: string,
  takenSlugs: ReadonlySet<string>,
): GenerateSlugResult {
  const base = slugify(title);
  if (base === "") {
    return { ok: false, reason: "empty_slug" };
  }
  let candidate = base;
  for (let attempt = 2; takenSlugs.has(candidate); attempt += 1) {
    const suffix = `-${attempt}`;
    candidate = truncateSlug(base, TEXT_LIMITS.slug - suffix.length) + suffix;
  }
  return { ok: true, slug: candidate };
}
