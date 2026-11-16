import { Inject, Injectable, Optional, RequestMethod, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type pg from "pg";
import type { EmailProviderPort } from "@fluxkit/core";
import { PG_POOL } from "../../database/database.module.js";
import { EMAIL_SUPPRESSION_GUARD_WIRED } from "../outbox/email-sender.js";
import { EmailWebhookController } from "../webhooks/email-webhook.controller.js";
import { EmailProviderRegistry } from "./email-provider-registry.js";

/** The exact step-1b journal entry; a table alone does not establish a completed installation. */
export const EMAIL_SUPPRESSION_MIGRATION_WHEN = 1794827031304;

type ReadinessDatabase = Pick<pg.Pool, "query">;

/** Read-only bootstrap preflight, before scheduler bootstrap and before the server accepts immediate sends. */
export async function assertEmailFallbackReadiness(
  database: ReadinessDatabase,
  providers: readonly EmailProviderPort[],
  guardWired: boolean,
  webhookRouteRegistered: boolean,
): Promise<void> {
  if (providers.length < 2) return;
  if (!guardWired)
    throw new Error("EMAIL_FALLBACK_PROVIDERS requires the shared email suppression sender guard.");
  if (!webhookRouteRegistered)
    throw new Error(
      "EMAIL_FALLBACK_PROVIDERS requires registered authenticated email webhook routes.",
    );
  for (const provider of providers) {
    if (typeof provider.webhookVerifier !== "function") {
      throw new Error(
        `EMAIL_FALLBACK_PROVIDERS requires an authenticated webhook verifier and webhook secret for provider ${provider.code}.`,
      );
    }
  }
  try {
    const journal = await database.query<{ applied: boolean }>(
      "select exists(select 1 from drizzle.__drizzle_migrations where created_at = $1) as applied",
      [EMAIL_SUPPRESSION_MIGRATION_WHEN],
    );
    if (journal.rows[0]?.applied !== true) throw new Error("missing journal");
    // Explicit columns catch incomplete schemas; no address, receipt or remote state is read or changed.
    await database.query(
      "select id, to_address, reason, source_provider, first_seen_at, last_seen_at from email_suppression where false",
    );
    await database.query(
      "select provider_code, event_key, to_address, event_at, received_at from email_webhook_receipt where false",
    );
    const privileges = await database.query<{ ready: boolean }>(`
      select bool_and(has_table_privilege(current_user, relation, privilege)) as ready
      from unnest(array['email_suppression', 'email_webhook_receipt']) as relation
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege
    `);
    if (privileges.rows[0]?.ready !== true) throw new Error("missing privileges");
  } catch {
    // Database errors can contain sensitive SQL values or connection details; never echo them at bootstrap.
    throw new Error(
      "EMAIL_FALLBACK_PROVIDERS requires applied migration 0017_email_suppression, queryable suppression/receipt schema, and SELECT/INSERT/UPDATE/DELETE privileges.",
    );
  }
}

@Injectable()
export class EmailFallbackReadiness implements OnModuleInit {
  constructor(
    @Inject(PG_POOL) private readonly database: pg.Pool,
    @Inject(EmailProviderRegistry) private readonly registry: EmailProviderRegistry,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Optional() @Inject(EMAIL_SUPPRESSION_GUARD_WIRED) private readonly guardWired?: boolean,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.discover();
    await assertEmailFallbackReadiness(
      this.database,
      this.registry.list(),
      this.guardWired === true,
      this.discovery
        .getControllers()
        .some((wrapper) => wrapper.metatype === EmailWebhookController) &&
        Reflect.getMetadata(PATH_METADATA, EmailWebhookController) === "webhooks/email" &&
        Reflect.getMetadata(PATH_METADATA, EmailWebhookController.prototype.receive) ===
          ":provider" &&
        Reflect.getMetadata(METHOD_METADATA, EmailWebhookController.prototype.receive) ===
          RequestMethod.POST,
    );
  }
}
