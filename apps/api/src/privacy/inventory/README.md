# Non-database storage inventory

- Redis rate-limit counters (`RATE_LIMIT_STORE=redis`, ADR 0055): pseudonymous subject HMACs, abuse-prevention purpose (legitimate interest). Keys: database namespace, internal limit name, HMAC-SHA256 of normalized subject; secret derived by HKDF-SHA256 from `ORDER_TOKEN_SECRET`, empty salt and info `rate-limit`. Values: integer attempt counts only. No raw address, email, customer/admin id or token.
- Retention: fixed window TTL (at most 24 hours), never renewed by rejection. No subject export; automatic expiry instead of early erasure so a subject cannot reset an abuse window. Access restricted to the API/operator; Redis is private. Memory mode and outage fallback retain only the original bounded per-process windows.
- These counters add no PostgreSQL table/column, so `coreInventory` and the generated database-column inventory stay unchanged. Operational details: [privacy guide](../../../../../docs/privacy/README.md#ephemeral-rate-limit-counters).
