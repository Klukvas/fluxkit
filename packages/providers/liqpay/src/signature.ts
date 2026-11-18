import { createHash } from "node:crypto";

/*
 * LiqPay signatures (ADR 0059): base64( sha3-256( private_key + data + private_key ) ) where `data` is base64(JSON).
 */

const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{8,256}={0,2}$/;

export function encodeData(params: object): string {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64");
}

export function signData(data: string, privateKey: string): string {
  const digest = createHash("sha3-256")
    .update(privateKey + data + privateKey, "utf8")
    .digest("base64");
  return digest;
}

export function signatureValid(data: string, signature: string, privateKey: string): boolean {
  if (!SIGNATURE_BASE64.test(signature)) {
    return false;
  }
  const expected = signData(data, privateKey);
  if (expected.length !== signature.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}

/** Whether a form field value can be a LiqPay `signature` (base64). */
export function signatureOf(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = header.trim();
  return SIGNATURE_BASE64.test(value) && value.length % 4 === 0 ? value : undefined;
}
