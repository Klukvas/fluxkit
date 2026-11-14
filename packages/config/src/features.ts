const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * The longest feature name. A feature's migrations table is `__drizzle_migrations_feature_<name>` (29 + name characters,
 * ADR 0049) and Postgres cuts identifiers at 63 bytes, so a longer name could be truncated into another feature's table.
 */
export const MAX_FEATURE_NAME_LENGTH = 32;

/**
 * Parses the comma-separated FEATURES_ENABLED value into a validated, de-duplicated list of feature names.
 * An unset or empty value means no optional features are enabled.
 */
export function parseEnabledFeatures(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const names = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  for (const name of names) {
    if (!FEATURE_NAME.test(name)) {
      throw new Error(
        `Invalid feature name "${name}" in FEATURES_ENABLED. Use lowercase letters, digits and dashes.`,
      );
    }
    if (name.length > MAX_FEATURE_NAME_LENGTH) {
      throw new Error(
        `Feature name "${name}" in FEATURES_ENABLED is longer than ${MAX_FEATURE_NAME_LENGTH} characters.`,
      );
    }
  }
  return [...new Set(names)];
}
