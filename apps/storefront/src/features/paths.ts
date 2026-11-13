/**
 * The path rule of a feature slice's links and sitemap pages (plan docs/plans/2026-11-13-blog.md, E6 and E7). Pure; shared by
 * the registry check and the sitemap.
 */

/** One path segment: no `/`, `?`, `#`, whitespace or control character, and not `.` or `..`. */
const SEGMENT = /^[^/?#\s\p{Cc}]+$/u;

/**
 * What is wrong with a path a slice names (`null` when nothing is): it must be `/<segment>[/<segment>...]` without the locale
 * (no query, fragment, whitespace, control character, empty or dot segment), and its first segment must be one of the slice's
 * own page segments (`segments`, from the generated registry), so a feature can only link to and list its own pages.
 */
export function featurePathProblem(path: string, segments: readonly string[]): string | null {
  const parts = path.split("/");
  if (
    parts[0] !== "" ||
    parts.length < 2 ||
    parts.slice(1).some((part) => !SEGMENT.test(part) || part === "." || part === "..")
  ) {
    return `"${path}" is not a storefront path "/<segment>..." without query, fragment, spaces or dot segments`;
  }
  const first = parts[1] ?? "";
  if (!segments.includes(first)) {
    return `"${path}" is not under one of the slice's own pages (${segments.length === 0 ? "it has none" : segments.map((segment) => `/${segment}`).join(", ")})`;
  }
  return null;
}
