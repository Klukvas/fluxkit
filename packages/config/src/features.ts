const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

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
  }
  return [...new Set(names)];
}
