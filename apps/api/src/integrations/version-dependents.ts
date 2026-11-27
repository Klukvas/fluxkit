import { inArray, sql } from "drizzle-orm";
import {
  EMAIL_MESSAGE_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  SHIPMENT_STATUSES,
  isFinalEmailStatus,
  isTerminalPaymentStatus,
  isTerminalRefundStatus,
  isTerminalShipmentStatus,
} from "@fluxkit/core";
import type { DbExecutor } from "../common/transaction.js";
import { emailMessage, payment, shipment } from "../database/schema/index.js";
import type { IntegrationVersionResponse } from "./integrations.schemas.js";

type Version = { id: string; kind: string };
type Dependents = IntegrationVersionResponse["dependents"];
type Counts = { id: string; open: number; total: number; oldestOpenAt: Date | null };
const closedPayments = PAYMENT_STATUSES.filter(isTerminalPaymentStatus);
const closedRefunds = REFUND_STATUSES.filter(isTerminalRefundStatus);
const closedShipments = SHIPMENT_STATUSES.filter(isTerminalShipmentStatus);
const closedEmails = EMAIL_MESSAGE_STATUSES.filter(isFinalEmailStatus);
const literals = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** One grouped query per relevant resource table for the entire response, independent of version count. */
export async function versionDependents(
  executor: DbExecutor,
  versions: readonly Version[],
): Promise<Map<string, Dependents>> {
  const output = new Map<string, Dependents>();
  const ids = (kind: string) => versions.filter((v) => v.kind === kind).map((v) => v.id);
  const paymentIds = ids("payment"),
    shipmentIds = ids("shipping"),
    emailIds = ids("email");
  if (paymentIds.length > 0) {
    const result = await executor.execute<Counts>(sql`
      with resources as (select payment.integration_credential_version_id as id, payment.created_at,
        (payment.status not in (${literals(closedPayments)}) or exists (
          select 1 from payment_refund r where r.payment_id=payment.id and r.status not in (${literals(closedRefunds)})
        )) as open from payment where ${inArray(payment.integrationCredentialVersionId, paymentIds)})
      select id, count(*)::int as total, count(*) filter (where open)::int as open,
        min(created_at) filter (where open) as "oldestOpenAt" from resources group by id`);
    for (const id of paymentIds)
      output.set(id, { payments: resourceCounts(result.rows.find((r) => r.id === id)) });
  }
  if (shipmentIds.length > 0) {
    const result = await executor.execute<Counts>(sql`
      select integration_credential_version_id as id, count(*)::int as total,
        count(*) filter (where status not in (${literals(closedShipments)}))::int as open,
        min(created_at) filter (where status not in (${literals(closedShipments)})) as "oldestOpenAt"
      from shipment where ${inArray(shipment.integrationCredentialVersionId, shipmentIds)} group by integration_credential_version_id`);
    for (const id of shipmentIds)
      output.set(id, { shipments: resourceCounts(result.rows.find((r) => r.id === id)) });
  }
  if (emailIds.length > 0) {
    const result = await executor.execute<{ id: string; pending: number; total: number }>(sql`
      select integration_credential_version_id as id, count(*)::int as total,
        count(*) filter (where status not in (${literals(closedEmails)}))::int as pending
      from email_message where ${inArray(emailMessage.integrationCredentialVersionId, emailIds)} group by integration_credential_version_id`);
    for (const id of emailIds) {
      const row = result.rows.find((r) => r.id === id);
      output.set(id, { emails: { pending: row?.pending ?? 0, total: row?.total ?? 0 } });
    }
  }
  return output;
}
function resourceCounts(row: Counts | undefined) {
  return {
    open: row?.open ?? 0,
    total: row?.total ?? 0,
    oldestOpenAt: row?.oldestOpenAt == null ? null : new Date(row.oldestOpenAt).toISOString(),
  };
}
