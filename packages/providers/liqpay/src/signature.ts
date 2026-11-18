import { createHash, timingSafeEqual } from "node:crypto";

/*
 * LiqPay signatures (ADR 0059): outbound `data` is base64(JSON); signature is
 * base64(sha3-256(private_key + data + private_key)) (API version 7 prose).
 * Official callback sample snippets still use sha1 of the same concatenation, so
 * inbound verify accepts either digest (constant-time). Outbound always signs SHA3-256.
 */

const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{8,256}={0,2}$/;

export function encodeData(params: object): string {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64");
}

function digestBase64(algorithm: "sha3-256" | "sha1", data: string, privateKey: string): string {
  return createHash(algorithm)
    .update(privateKey + data + privateKey, "utf8")
    .digest("base64");
}

export function signData(data: string, privateKey: string): string {
  return digestBase64("sha3-256", data, privateKey);
}

function matchesDigest(signature: string, expected: string): boolean {
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function signatureValid(data: string, signature: string, privateKey: string): boolean {
  if (!SIGNATURE_BASE64.test(signature)) {
    return false;
  }
  const sha3 = digestBase64("sha3-256", data, privateKey);
  const sha1 = digestBase64("sha1", data, privateKey);
  // Both compares always run so timing does not reveal which algorithm matched.
  const sha3Ok = matchesDigest(signature, sha3);
  const sha1Ok = matchesDigest(signature, sha1);
  return sha3Ok || sha1Ok;
}

/** Whether a form field value can be a LiqPay `signature` (base64). */
export function signatureOf(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = header.trim();
  return SIGNATURE_BASE64.test(value) && value.length % 4 === 0 ? value : undefined;
}
