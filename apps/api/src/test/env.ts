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
