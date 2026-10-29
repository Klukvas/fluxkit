import type { AdminConfig, ProblemDetails } from "@fluxkit/api-client";
import { Alert, LiveRegion, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { adminClient } from "../../lib/api";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import { useResource, type ResourceView } from "../../lib/use-resource";

/** Presentational helpers of the orders area: props in, markup out, every word from the translator. */

export const linkClass = "font-medium text-foreground underline underline-offset-4";
export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function describe(t: Translator, descriptor: MessageDescriptor): string {
  return t(descriptor.key, descriptor.values);
}

/** A message with the unknown code in small print (admins need it for support). */
export function DescriptorText({
  t,
  descriptor,
}: {
  t: Translator;
  descriptor: MessageDescriptor;
}) {
  return (
    <>
      {describe(t, descriptor)}
      {descriptor.code === undefined ? null : (
        <small className="ms-2 text-muted-foreground">
          {t("errors.reference", { code: descriptor.code })}
        </small>
      )}
    </>
  );
}

/** Rules of the order actions that get an explanation of their own (what happened and what to do instead). */
export const ORDER_REFUSAL_RULES = [
  "amount_mismatch",
  "awaiting_stock",
  "order_not_payable",
  "payment_reference_conflict",
  "payment_in_progress",
  "invalid_transition",
] as const;

/**
 * A refusal of an order action: the orders area's own explanation for the order rules, the shell's problem map for
 * everything else (`403`, `404`, `400` without a field, an unknown code). The API's English `detail` is never shown.
 */
export function describeOrderProblem(status: number, problem: ProblemDetails): MessageDescriptor {
  const rule = problem.code === "rule_violation" ? problem.rule : problem.code;
  if (rule !== undefined && (ORDER_REFUSAL_RULES as readonly string[]).includes(rule)) {
    return { key: `order.refusal.${rule}` };
  }
  return describeProblem(status, problem);
}

/** Field issues the orders forms know (local checks and the API's `errors[].code` for the same fields). */
export const ORDER_FIELD_ISSUES = [
  "required",
  "too_long",
  "too_big",
  "too_small",
  "invalid_characters",
  "confirmation_required",
] as const;

export function describeOrderFieldIssue(code: string): MessageDescriptor {
  return (ORDER_FIELD_ISSUES as readonly string[]).includes(code)
    ? { key: `order.field.${code}` }
    : describeFieldError(code);
}

/** The `errors[]` entry of a `400` on one field of the body, if any. */
export function fieldIssueFromProblem(problem: ProblemDetails, field: string): string | null {
  return problem.errors?.find((entry) => entry.path === field)?.code ?? null;
}

/**
 * The status line of a screen: always in the page (a live region announces changes of a region that was already
 * there), focusable so the focus can move to it after an action.
 */
export function StatusLine({
  innerRef,
  children,
}: {
  innerRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>{children}</LiveRegion>
    </div>
  );
}

/** A refusal or an error inside a dialog, focusable so the focus can move to it. */
export function DialogError({
  t,
  descriptor,
  innerRef,
}: {
  t: Translator;
  descriptor: MessageDescriptor | null;
  innerRef?: Ref<HTMLDivElement>;
}) {
  if (descriptor === null) return null;
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <Alert variant="danger">
        <p>
          <DescriptorText t={t} descriptor={descriptor} />
        </p>
      </Alert>
    </div>
  );
}

/** Previous and next page as links (the page is in the URL); the range is spelled out for assistive technology too. */
export function OrderPager({
  t,
  total,
  limit,
  offset,
  count,
  hrefForOffset,
}: {
  t: Translator;
  total: number;
  limit: number;
  offset: number;
  count: number;
  hrefForOffset: (offset: number) => string;
}) {
  if (total === 0) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + count < total;
  return (
    <nav aria-label={t("order.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("order.list.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("order.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("order.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}

/** The admin config (currency exponents for the money display), read once per screen. */
export function useOrderConfig(): ResourceView<AdminConfig> {
  return useResource((signal) => adminClient.getConfig({ signal }), []);
}
