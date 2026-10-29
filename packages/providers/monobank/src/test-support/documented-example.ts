/*
 * TEST ONLY. The webhook signature example of Monobank's documentation, copied verbatim (M12): the tag "Приклади
 * верифікації підпису webhook" of the OpenAPI spec "Acquiring v2410" embedded in https://api.monobank.ua/docs/acquiring.html
 * (the same values are on https://monobank.ua/api-docs/acquiring/dev/webhooks/verify), read 2026-10-29. The key is
 * Monobank's public EXAMPLE key, not a secret and not the live key.
 *
 * The body is the example's JSON text with two-space indentation and the closing brace in column 0 (the Go, Python, PHP and
 * Node examples show it inside a code block indented by two more spaces; with those extra spaces the signature does not
 * verify, without them it does, checked with Node's `crypto.verify` on 2026-10-29).
 */

export const DOCUMENTED_PUBKEY_BASE64 =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFQUc1LzZ3NnZubGJZb0ZmRHlYWE4vS29CbVVjTgo3NWJSUWg4MFBhaEdldnJoanFCQnI3OXNSS0JSbnpHODFUZVQ5OEFOakU1c0R3RmZ5Znhub0ZJcmZBPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==";

export const DOCUMENTED_X_SIGN =
  "MEUCIQC/mVKhi8FKoayul2Mim3E2oaIOCNJk5dEXxTqbkeJSOQIgOM0hsW0qcP2H8iXy1aQYpmY0SJWEaWur7nQXlKDCFxA=";

export const DOCUMENTED_BODY = [
  "{",
  '  "invoiceId": "p2_9ZgpZVsl3",',
  '  "status": "created",',
  '  "failureReason": "string",',
  '  "amount": 4200,',
  '  "ccy": 980,',
  '  "finalAmount": 4200,',
  '  "createdDate": "2019-08-24T14:15:22Z",',
  '  "modifiedDate": "2019-08-24T14:15:22Z",',
  '  "reference": "84d0070ee4e44667b31371d8f8813947",',
  '  "cancelList": [',
  "    {",
  '      "status": "processing",',
  '      "amount": 4200,',
  '      "ccy": 980,',
  '      "createdDate": "2019-08-24T14:15:22Z",',
  '      "modifiedDate": "2019-08-24T14:15:22Z",',
  '      "approvalCode": "662476",',
  '      "rrn": "060189181768",',
  '      "extRef": "635ace02599849e981b2cd7a65f417fe"',
  "    }",
  "  ]",
  "}",
].join("\n");
