import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeData, signData, signatureValid } from "./signature.js";

describe("LiqPay signature", () => {
  const privateKey = "sandbox_private_invented34";
  const params = {
    action: "pay",
    version: 7,
    public_key: "sandbox_public_invented12",
    order_id: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    amount: 1250,
    currency: "UAH",
  };

  it("round-trips data and signature", () => {
    const data = encodeData(params);
    const signature = signData(data, privateKey);
    expect(signatureValid(data, signature, privateKey)).toBe(true);
    expect(signatureValid(data, `${signature}x`, privateKey)).toBe(false);
    const tampered = encodeData({ ...params, amount: 1251 });
    expect(signatureValid(tampered, signature, privateKey)).toBe(false);
  });

  it("accepts the SHA-1 digest used in official callback sample snippets", () => {
    const data = encodeData(params);
    const sha1 = createHash("sha1")
      .update(privateKey + data + privateKey, "utf8")
      .digest("base64");
    expect(signatureValid(data, sha1, privateKey)).toBe(true);
    expect(signData(data, privateKey)).not.toBe(sha1);
  });
});
