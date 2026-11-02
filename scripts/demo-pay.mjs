#!/usr/bin/env node
// `pnpm demo:pay [--order <number>] [--fail]`: "pays" the newest unpaid attempt of the TEST-ONLY `fake` payment provider in
// the local demo (README "Try it locally"). The fake has no payment page (`https://pay.fake.invalid` resolves nowhere), so
// this script plays the provider the way the e2e suites do (packages/providers/_fake-payment/README.md, "Driving it from
// another process"): it posts the provider's webhook, signed with the fake's PUBLIC test key, to the running API's
// `POST /webhooks/payments/fake`. The API runs its real signature check and payment rules. `--fail` announces a failed
// payment instead.
//
// Development only: refuses NODE_ENV=production, a database whose name does not end in _dev, _demo, _local or _test, and
// every provider but `fake`. Changes nothing itself: it reads one row and sends one request.
import { createHmac } from "node:crypto";
import { assertDemoDatabase, loadPg, readEnvFile } from "./demo-lib.mjs";

/** The fake's fixed, public test key (never a secret; packages/providers/_fake-payment/README.md). */
const FAKE_WEBHOOK_KEY = "fluxkit-fake-payment-webhook-test-key";

function parseArgs(argv) {
  const options = { order: undefined, fail: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--order" && argv[index + 1] !== undefined) {
      options.order = argv[++index];
    } else if (argv[index] === "--fail") {
      options.fail = true;
    } else {
      throw new Error(
        `Unknown argument ${argv[index]}. Usage: pnpm demo:pay [--order <number>] [--fail]`,
      );
    }
  }
  return options;
}

async function findAttempt(values, orderNumber) {
  const { Client } = loadPg();
  const client = new Client({ connectionString: values.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `select p.id, p.provider_payment_id, p.amount, p.currency, o.number
         from payment p join sales_order o on o.id = p.order_id
        where p.provider_code = 'fake' and p.status in ('awaiting_customer', 'processing')
          and p.provider_payment_id is not null and ($1::text is null or o.number = $1)
        order by p.created_at desc limit 1`,
      [orderNumber ?? null],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const values = readEnvFile();
  assertDemoDatabase(values);
  if (!(values.PAYMENT_PROVIDERS_ENABLED ?? "").split(",").includes("fake")) {
    throw new Error("PAYMENT_PROVIDERS_ENABLED in .env does not contain fake.");
  }
  const attempt = await findAttempt(values, options.order);
  if (attempt === undefined) {
    throw new Error(
      options.order === undefined
        ? "No unpaid fake payment found. Place an order in the shop and press the pay button first."
        : `No unpaid fake payment found for order ${options.order}.`,
    );
  }
  const amount = Number(attempt.amount);
  const paid = !options.fail;
  const body = JSON.stringify({
    invoiceId: attempt.provider_payment_id,
    reference: attempt.id,
    status: paid ? "success" : "failure",
    amount,
    currency: attempt.currency,
    finalAmount: paid ? amount : null,
    modifiedDate: new Date().toISOString(),
    failureCode: paid ? null : "demo_declined",
    cancelList: [],
    card: paid ? { system: "visa", last4: "4242" } : null,
  });
  const signature = createHmac("sha256", FAKE_WEBHOOK_KEY).update(body, "utf8").digest("hex");
  const api = `http://127.0.0.1:${values.PORT || "3000"}`;
  let response;
  try {
    response = await globalThis.fetch(`${api}/webhooks/payments/fake`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fake-signature": signature },
      body,
    });
  } catch (error) {
    throw new Error(
      `The API at ${api} did not answer; start it with pnpm --filter @fluxkit/api start.`,
      {
        cause: error,
      },
    );
  }
  if (!response.ok) {
    throw new Error(
      `The API answered the webhook with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const storefront = values.STOREFRONT_PUBLIC_URL || "http://localhost:3001";
  console.log(
    `Order ${attempt.number}: the fake provider reported the payment as ${paid ? "paid" : "failed"}.`,
  );
  console.log(`Return page: ${storefront}/uk/payment/return?payment=${attempt.id}`);
}

main().catch((error) => {
  console.error(`demo:pay failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
