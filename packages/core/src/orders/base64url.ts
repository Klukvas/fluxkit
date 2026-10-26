/*
 * Unpadded base64url, written out because core has no Buffer or btoa. Internal to core (not re-exported from the
 * barrel): shared by the derived tokens of ADR 0023 (`access-token.ts`) and ADR 0031 (`email/auth-token.ts`).
 */

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const symbols = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
    for (let position = 0; position < symbols; position += 1) {
      text += BASE64URL.charAt((chunk >> (18 - 6 * position)) & 63);
    }
  }
  return text;
}
