import type { AdminPayment } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DescriptionList,
  Field,
  Input,
  Textarea,
  type Translator,
} from "@fluxkit/ui";
import { useEffect, useRef, type FormEvent, type Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { DescriptorText, DialogError, focusClass } from "../orders/order-parts";
import { moneyText, type MoneyContext } from "../orders/order-view";
import { REFUND_NOTE_MAX_LENGTH, type RefundAmountIssue, type RefundValues } from "./refund-form";
import type { TextIssue } from "../orders/action-text";
import { attentionCodeKey } from "./payment-view";

/**
 * The dialogs of the payment actions: props in, markup out. The refund dialog has two steps in one dialog: the form (amount
 * and note) and the confirmation of what will be sent. Nothing is sent by the form; the page sends after the confirmation
 * only. Every button is off while the write runs and Escape does nothing then.
 */

export type RefundStep = "form" | "confirm";

export interface RefundDialogProps {
  t: Translator;
  open: boolean;
  step: RefundStep;
  orderNumber: string;
  payment: AdminPayment | null;
  money: MoneyContext;
  currency: string;
  exponent: number;
  values: RefundValues;
  onChange: (values: RefundValues) => void;
  amountIssue: RefundAmountIssue | null;
  noteIssue: TextIssue | null;
  /** A `400` of the API on one field, shown there instead of on top. */
  amountError: MessageDescriptor | null;
  noteError: MessageDescriptor | null;
  /** A refusal or another failure of the last send. */
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  /** After a lost answer: the dialog holds the request that was sent (a repeat of it is safe). */
  retrying: boolean;
  /** Text of the amount to be refunded, formatted from the parsed minor units (confirmation step only). */
  confirmAmountText: string;
  busy: boolean;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RefundDialog({
  t,
  open,
  step,
  orderNumber,
  payment,
  money,
  currency,
  exponent,
  values,
  onChange,
  amountIssue,
  noteIssue,
  amountError,
  noteError,
  error,
  errorRef,
  retrying,
  confirmAmountText,
  busy,
  onReview,
  onBack,
  onConfirm,
  onClose,
}: RefundDialogProps) {
  const stepRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The step changed inside an open dialog: the focus moves to the new step (its first element is not focused by the dialog).
    if (open && step === "confirm") stepRef.current?.focus();
  }, [open, step]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onReview();
  }
  const remaining = payment === null ? "" : moneyText(payment.refundableAmount, money);
  const amountDescriptor: MessageDescriptor | null =
    amountError ??
    (amountIssue === null
      ? null
      : {
          key: `payment.refund.amountIssue.${amountIssue}`,
          values: { max: remaining, decimals: exponent },
        });
  const noteDescriptor: MessageDescriptor | null =
    noteError ?? (noteIssue === null ? null : { key: `payment.refund.noteIssue.${noteIssue}` });
  const overview: { id: string; term: string; description: string }[] =
    payment === null
      ? []
      : [
          {
            id: "paid",
            term: t("payment.refund.paid"),
            description: moneyText(payment.amount, money),
          },
          {
            id: "refunded",
            term: t("payment.refund.alreadyRefunded"),
            description: moneyText(payment.refundedAmount, money),
          },
          { id: "remaining", term: t("payment.refund.remaining"), description: remaining },
        ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      role={step === "confirm" ? "alertdialog" : undefined}
      aria-busy={busy || undefined}
      title={t("payment.refund.title", { number: orderNumber })}
      description={t(
        step === "confirm" ? "payment.refund.confirmDescription" : "payment.refund.description",
      )}
      footer={
        step === "confirm" ? (
          <>
            <Button
              variant="secondary"
              data-autofocus=""
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={onBack}
            >
              {t("payment.refund.back")}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={onConfirm}
            >
              {busy
                ? t("order.dialog.sending")
                : t("payment.refund.confirm", { amount: confirmAmountText })}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {t("order.dialog.cancel")}
            </Button>
            <Button type="submit" form="payment-refund" disabled={busy}>
              {t("payment.refund.review")}
            </Button>
          </>
        )
      }
    >
      <DialogError t={t} descriptor={error} innerRef={errorRef} />
      {retrying ? <Alert variant="info">{t("payment.refund.retryHint")}</Alert> : null}
      {step === "confirm" ? (
        <div ref={stepRef} tabIndex={-1} className={`${focusClass} flex flex-col gap-3`}>
          <Alert variant="warning" title={t("payment.refund.confirmTitle")}>
            <p>{t("payment.refund.confirmBody", { amount: confirmAmountText, currency })}</p>
          </Alert>
          <DescriptionList
            items={[
              {
                id: "amount",
                term: t("payment.refund.confirmAmount"),
                description: confirmAmountText,
              },
              {
                id: "note",
                term: t("payment.refund.note"),
                description: <span className="break-words">{values.note.trim()}</span>,
              },
            ]}
          />
        </div>
      ) : (
        <form
          id="payment-refund"
          method="post"
          onSubmit={submit}
          className="flex flex-col gap-4"
          noValidate
        >
          <DescriptionList items={overview} />
          <Field
            id="payment-refund-amount"
            label={t("payment.refund.amount", { currency })}
            hint={t("payment.refund.amountHint", { max: remaining, decimals: exponent })}
            error={
              amountDescriptor === null ? undefined : (
                <DescriptorText t={t} descriptor={amountDescriptor} />
              )
            }
            required
            requiredIndicator={t("order.dialog.requiredMark")}
          >
            {(control) => (
              <Input
                {...control}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                disabled={busy}
                value={values.amount}
                onChange={(event) => onChange({ ...values, amount: event.target.value })}
              />
            )}
          </Field>
          <Field
            id="payment-refund-note"
            label={t("payment.refund.note")}
            hint={t("payment.refund.noteHint", { max: REFUND_NOTE_MAX_LENGTH })}
            error={
              noteDescriptor === null ? undefined : (
                <DescriptorText t={t} descriptor={noteDescriptor} />
              )
            }
            required
            requiredIndicator={t("order.dialog.requiredMark")}
          >
            {(control) => (
              <Textarea
                {...control}
                name="note"
                rows={3}
                maxLength={REFUND_NOTE_MAX_LENGTH}
                disabled={busy}
                value={values.note}
                onChange={(event) => onChange({ ...values, note: event.target.value })}
              />
            )}
          </Field>
        </form>
      )}
    </Dialog>
  );
}

export function ClearAttentionDialog({
  t,
  payment,
  error,
  errorRef,
  busy,
  onConfirm,
  onClose,
}: {
  t: Translator;
  payment: Pick<AdminPayment, "attentionCode"> | null;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const code = attentionCodeKey(payment?.attentionCode ?? null);
  return (
    <ConfirmDialog
      open={payment !== null}
      busy={busy}
      title={t("payment.clear.title")}
      description={t("payment.clear.body")}
      confirmLabel={busy ? t("order.dialog.sending") : t("payment.clear.confirm")}
      cancelLabel={t("payment.clear.keep")}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3">
        <p className="font-medium text-foreground">{t(`payment.attention.code.${code}`)}</p>
        <p className="text-muted-foreground">{t("payment.clear.note")}</p>
        <DialogError t={t} descriptor={error} innerRef={errorRef} />
      </div>
    </ConfirmDialog>
  );
}
