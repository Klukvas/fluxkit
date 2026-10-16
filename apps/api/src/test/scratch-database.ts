import { randomBytes } from "node:crypto";
import pg from "pg";
import { requireTestDatabaseUrl } from "./env.js";

export interface ScratchDatabase {
  /** Connection string of the new, empty database. */
  url: string;
  name: string;
  drop: () => Promise<void>;
}

/**
 * TEST ONLY: creates an empty database next to the `_test` database, so a spec can start from "nothing migrated"
 * without wiping the shared one. The name ends in `_test`, so the destructive-test guards accept it.
 */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const baseUrl = requireTestDatabaseUrl();
  const name = `fluxkit_mig_${randomBytes(6).toString("hex")}_test`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    drop: async () => {
      const client = new pg.Client({ connectionString: baseUrl });
      await client.connect();
      try {
        await client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`);
      } finally {
        await client.end();
      }
    },
  };
}
