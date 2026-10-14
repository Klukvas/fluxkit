/** Integration tests need real services. A missing variable fails the test loudly instead of skipping it. */
export function requireEnv(name: "DATABASE_URL" | "REDIS_URL"): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run integration tests (see .env.example and infra/README.md).`,
    );
  }
  return value;
}

/**
 * For tests that drop or recreate schema objects. Refuses any database whose name does not end in "_test",
 * so a developer's migrated dev database can never be wiped by accident.
 */
export function requireTestDatabaseUrl(): string {
  const url = requireEnv("DATABASE_URL");
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run a destructive test against database "${databaseName}". Point DATABASE_URL at a database whose name ends in "_test".`,
    );
  }
  return url;
}
