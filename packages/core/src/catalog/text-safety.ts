/**
 * Postgres jsonb refuses the NUL character and unpaired UTF-16 surrogates. Validating them here turns a
 * database error (HTTP 500) into a field error (HTTP 400).
 */
const JSONB_UNSAFE =
  /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;

export function hasJsonbUnsafeCharacters(text: string): boolean {
  return JSONB_UNSAFE.test(text);
}
