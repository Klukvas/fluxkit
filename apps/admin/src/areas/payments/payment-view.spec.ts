import { ADMIN_OPERATIONS } from "@fluxkit/api-client";
import {
  PAYMENT_ATTENTION_CODES as CORE_ATTENTION_CODES,
  PAYMENT_CREATED_BY,
  PAYMENT_EVENT_SOURCES as CORE_EVENT_SOURCES,
  PAYMENT_ORDER_OUTCOMES as CORE_ORDER_OUTCOMES,
  PAYMENT_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  ROLE_PERMISSIONS,
} from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { paymentFixture } from "../../test-helpers";
import {
  PAYMENT_ACTION_OPERATIONS,
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CREATORS,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_ORDER_OUTCOMES,
  PAYMENT_STATUS_LIST,
  PAYMENT_STATUS_TONES,
  REFUND_REASON_LIST,
  REFUND_STATUS_LIST,
  REFUND_STATUS_TONES,
  attentionCodeKey,
  hasSucceededPayment,
  offeredPaymentActions,
  paymentEntryActor,
} from "./payment-view";

const OWNER = [...ROLE_PERMISSIONS.owner];
const MANAGER = [...ROLE_PERMISSIONS.manager];
const VIEWER = [...ROLE_PERMISSIONS.viewer];

describe("the lists the panel builds messages from agree with core", () => {
  it("covers every status, reason, attention code, source, outcome and creator core knows", () => {
    expect([...PAYMENT_STATUS_LIST].sort()).toEqual([...PAYMENT_STATUSES].sort());
    expect([...REFUND_STATUS_LIST].sort()).toEqual([...REFUND_STATUSES].sort());
    expect([...REFUND_REASON_LIST].sort()).toEqual([...REFUND_REASONS].sort());
    expect([...PAYMENT_ATTENTION_CODES].sort()).toEqual([...CORE_ATTENTION_CODES].sort());
    expect([...PAYMENT_EVENT_SOURCES].sort()).toEqual([...CORE_EVENT_SOURCES].sort());
    expect([...PAYMENT_ORDER_OUTCOMES].sort()).toEqual([...CORE_ORDER_OUTCOMES].sort());
    expect([...PAYMENT_CREATORS].sort()).toEqual([...PAYMENT_CREATED_BY].sort());
  });

  it("has a tone for every status (the text says it, the tone is a hint)", () => {
    expect(Object.keys(PAYMENT_STATUS_TONES).sort()).toEqual([...PAYMENT_STATUS_LIST].sort());
    expect(Object.keys(REFUND_STATUS_TONES).sort()).toEqual([...REFUND_STATUS_LIST].sort());
    expect(PAYMENT_STATUS_TONES.succeeded).toBe("success");
    expect(PAYMENT_STATUS_TONES.failed).toBe("danger");
    expect(PAYMENT_STATUS_TONES.create_unknown).toBe("warning");
    expect(REFUND_STATUS_TONES.unknown).toBe("warning");
  });
});

describe("attention codes", () => {
  it("names a known code and falls back to a generic text for one this build does not know", () => {
    expect(attentionCodeKey("late_payment")).toBe("late_payment");
    expect(attentionCodeKey("reconcile_gave_up")).toBe("reconcile_gave_up");
    expect(attentionCodeKey("from_the_future" as never)).toBe("unknown");
    expect(attentionCodeKey(null)).toBe("unknown");
  });
});

describe("the action table follows the API operations' permissions", () => {
  it("names the operations the plan lists", () => {
    expect(PAYMENT_ACTION_OPERATIONS).toEqual({
      refund: "refundPayment",
      resync: "resyncPayment",
      clearAttention: "clearPaymentAttention",
    });
    expect(ADMIN_OPERATIONS.refundPayment.permission).toBe("payments.refund");
    expect(ADMIN_OPERATIONS.clearPaymentAttention.permission).toBe("payments.refund");
    expect(ADMIN_OPERATIONS.resyncPayment.permission).toBe("orders.write");
    expect(ADMIN_OPERATIONS.listOrderPayments.permission).toBe("orders.read");
    expect(ADMIN_OPERATIONS.listPayments.permission).toBe("orders.read");
  });
});

describe("offered payment actions", () => {
  const paid = paymentFixture();

  it("offers the owner and the manager everything on a paid payment with an open item", () => {
    const open = paymentFixture({ needsAttention: true, attentionCode: "late_payment" });
    expect(offeredPaymentActions(open, OWNER)).toEqual(["refund", "resync", "clearAttention"]);
    expect(offeredPaymentActions(open, MANAGER)).toEqual(["refund", "resync", "clearAttention"]);
  });

  it("offers a session that only reads orders no action at all", () => {
    const open = paymentFixture({ needsAttention: true, attentionCode: "late_payment" });
    expect(offeredPaymentActions(open, ["orders.read"])).toEqual([]);
  });

  it("offers the viewer and a signed-out session nothing", () => {
    expect(offeredPaymentActions(paid, VIEWER)).toEqual([]);
    expect(offeredPaymentActions(paid, null)).toEqual([]);
  });

  it("gates the refund by payments.refund alone, not by the order permissions", () => {
    expect(offeredPaymentActions(paid, ["orders.read", "orders.write"])).toEqual(["resync"]);
    expect(offeredPaymentActions(paid, ["orders.read", "payments.refund"])).toEqual(["refund"]);
  });

  it("gates the check status by orders.write", () => {
    expect(offeredPaymentActions(paid, ["orders.write"])).toEqual(["resync"]);
    expect(offeredPaymentActions(paid, ["payments.refund"])).toEqual(["refund"]);
  });

  it("offers a refund only for a succeeded attempt with something left", () => {
    for (const status of PAYMENT_STATUS_LIST) {
      const actions = offeredPaymentActions(paymentFixture({ status }), OWNER);
      expect(actions.includes("refund"), status).toBe(status === "succeeded");
    }
    const refunded = paymentFixture({
      refundedAmount: { amount: 18900, currency: "UAH" },
      refundableAmount: { amount: 0, currency: "UAH" },
    });
    expect(offeredPaymentActions(refunded, OWNER)).toEqual(["resync"]);
  });

  it("offers the check status only for an attempt the provider knows", () => {
    expect(offeredPaymentActions(paymentFixture({ providerPaymentId: null }), OWNER)).toEqual([
      "refund",
    ]);
    const unknown = paymentFixture({ status: "create_unknown", providerPaymentId: null });
    expect(offeredPaymentActions(unknown, OWNER)).toEqual([]);
  });

  it("offers clearing only while the item is open", () => {
    expect(offeredPaymentActions(paymentFixture({ needsAttention: false }), OWNER)).not.toContain(
      "clearAttention",
    );
    const cleared = paymentFixture({ needsAttention: false, attentionCode: "late_payment" });
    expect(offeredPaymentActions(cleared, OWNER)).not.toContain("clearAttention");
  });
});

describe("misc helpers", () => {
  it("finds a succeeded attempt among the order's payments", () => {
    expect(hasSucceededPayment([paymentFixture({ status: "failed" })])).toBe(false);
    expect(hasSucceededPayment([paymentFixture({ status: "failed" }), paymentFixture()])).toBe(
      true,
    );
    expect(hasSucceededPayment([])).toBe(false);
  });

  it("labels the journal actor: the provider and the system never get an admin label", () => {
    const me = "11111111-1111-4111-8111-111111111111";
    expect(paymentEntryActor({ source: "webhook", actorAdminId: null }, me, null)).toEqual({
      kind: "system",
    });
    expect(paymentEntryActor({ source: "admin", actorAdminId: me }, me, null)).toEqual({
      kind: "you",
    });
    expect(paymentEntryActor({ source: "admin", actorAdminId: null }, me, null)).toEqual({
      kind: "removedAdmin",
    });
  });
});
