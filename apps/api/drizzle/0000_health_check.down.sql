-- Hand-written rollback for 0000_health_check (drizzle-kit does not generate down migrations).
DROP TABLE IF EXISTS "health_check";
