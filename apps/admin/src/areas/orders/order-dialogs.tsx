import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Textarea,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  CANCELLATION_REASON_MAX_LENGTH,
  type CancelConsequence,
  type CancelValues,
} from "./cancel-form";
import { PAYMENT_REFERENCE_MAX_LENGTH, type MarkPaidValues } from "./mark-paid-form";
import { DescriptorText, DialogError } from "./order-parts";

/**
 * The dialogs of the order actions: props in, markup out. Each form posts nothing by itself (`method="post"`, no
 * `action`, the page handles the submit), every button is off while the write runs, and Escape does nothing then.
 */

export interface MarkPaidDialogProps {
  t: Translator;
  open: boolean;
  orderNumber: string;
  /** The order total, formatted from its integer minor units: shown, never edited, never parsed. */
  amountText: string;
  currency: string;
  values: MarkPaidValues;
  onChange: (values: MarkPaidValues) => void;
  referenceError: MessageDescriptor | null;
  receivedError: MessageDescriptor | null;
  /** A refusal or another failure of the last send. */
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  /** After a lost answer: the reference is the one sent before (a retry with it is safe). */
  retrying: boolean;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export function MarkPaidDialog({
  t,
  open,
  orderNumber,
  amountText,
  currency,
  values,
  onChange,
  referenceError,
  receivedError,
  error,
  errorRef,
  retrying,
  busy,
  onSubmit,
  onClose,
}: MarkPaidDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={t("order.markPaid.title", { number: orderNumber })}
      description={t("order.markPaid.description")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("order.dialog.cancel")}
          </Button>
          <Button
            type="submit"
            form="order-mark-paid"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? t("order.dialog.sending") : t("order.markPaid.submit")}
          </Button>
        </>
      }
    >
      <form
        id="order-mark-paid"
        method="post"
        onSubmit={submit}
        className="flex flex-col gap-4"
        noValidate
      >
        <DialogError t={t} descriptor={error} innerRef={errorRef} />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground" id="order-mark-paid-amount-label">
            {t("order.markPaid.amount")}
          </p>
          <p
            aria-labelledby="order-mark-paid-amount-label"
            className="text-xl font-semibold text-foreground"
          >
            {t("order.markPaid.amountValue", { amount: amountText, currency })}
          </p>
          <p className="text-sm text-muted-foreground">{t("order.markPaid.amountHint")}</p>
        </div>
        {retrying ? <Alert variant="info">{t("order.markPaid.retryHint")}</Alert> : null}
        <Field
          id="order-mark-paid-reference"
          label={t("order.markPaid.reference")}
          hint={t("order.markPaid.referenceHint", { max: PAYMENT_REFERENCE_MAX_LENGTH })}
          error={
            referenceError === null ? undefined : (
              <DescriptorText t={t} descriptor={referenceError} />
            )
          }
          required
          requiredIndicator={t("order.dialog.requiredMark")}
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              value={values.reference}
              maxLength={PAYMENT_REFERENCE_MAX_LENGTH}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => onChange({ ...values, reference: event.target.value })}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox
            id="order-mark-paid-received"
            name="received"
            label={t("order.markPaid.received", { amount: amountText })}
            checked={values.received}
            required
            disabled={busy}
            aria-invalid={receivedError === null ? undefined : true}
            aria-describedby={receivedError === null ? undefined : "order-mark-paid-received-error"}
            onChange={(event) => onChange({ ...values, received: event.target.checked })}
          />
          {receivedError === null ? null : (
            <p id="order-mark-paid-received-error" className="text-sm text-danger">
              <DescriptorText t={t} descriptor={receivedError} />
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export interface FulfilDialogProps {
  t: Translator;
  open: boolean;
  orderNumber: string;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function FulfilDialog({
  t,
  open,
  orderNumber,
  error,
  errorRef,
  busy,
  onConfirm,
  onClose,
}: FulfilDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      title={t("order.fulfil.title", { number: orderNumber })}
      description={t("order.fulfil.description")}
      confirmLabel={busy ? t("order.dialog.sending") : t("order.fulfil.submit")}
      cancelLabel={t("order.dialog.cancel")}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <DialogError t={t} descriptor={error} innerRef={errorRef} />
    </ConfirmDialog>
  );
}

export interface CancelDialogProps {
  t: Translator;
  open: boolean;
  orderNumber: string;
  consequence: CancelConsequence | null;
  values: CancelValues;
  onChange: (values: CancelValues) => void;
  reasonError: MessageDescriptor | null;
  error: MessageDescriptor | null;
  errorRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export function CancelDialog({
  t,
  open,
  orderNumber,
  consequence,
  values,
  onChange,
  reasonError,
  error,
  errorRef,
  busy,
  onSubmit,
  onClose,
}: CancelDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      role="alertdialog"
      title={t("order.cancel.title", { number: orderNumber })}
      footer={
        <>
          <Button variant="secondary" data-autofocus="" disabled={busy} onClick={onClose}>
            {t("order.cancel.keep")}
          </Button>
          <Button
            type="submit"
            form="order-cancel"
            variant="danger"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? t("order.dialog.sending") : t("order.cancel.submit")}
          </Button>
        </>
      }
    >
      <form
        id="order-cancel"
        method="post"
        onSubmit={submit}
        className="flex flex-col gap-4"
        noValidate
      >
        <DialogError t={t} descriptor={error} innerRef={errorRef} />
        {consequence === "release_unsold" ? (
          <Alert variant="warning" title={t("order.cancel.paidTitle")}>
            <p>{t("order.cancel.paidBody")}</p>
          </Alert>
        ) : consequence === "release" ? (
          <p className="text-muted-foreground">{t("order.cancel.unpaidBody")}</p>
        ) : null}
        <Field
          id="order-cancel-reason"
          label={t("order.cancel.reason")}
          hint={t("order.cancel.reasonHint", { max: CANCELLATION_REASON_MAX_LENGTH })}
          error={
            reasonError === null ? undefined : <DescriptorText t={t} descriptor={reasonError} />
          }
          required
          requiredIndicator={t("order.dialog.requiredMark")}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              rows={3}
              value={values.reason}
              maxLength={CANCELLATION_REASON_MAX_LENGTH}
              disabled={busy}
              onChange={(event) => onChange({ reason: event.target.value })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
