import type { ProblemDetails } from "@fluxkit/api-client";
import { LiveRegion, type Translator } from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { describeProblem, type MessageDescriptor } from "../../lib/problem-messages";

/** Presentational helpers of the customers area: props in, markup out, every word from the translator. */

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

/**
 * A refusal of a customer action: the shell's problem map says it (`403`, `404`, `400`, `429`, `413`, an unknown code).
 * The customer routes document no rule codes of their own (`docs/api/customers.md`: errors `400` and `404`), so the area
 * needs no map of its own. The API's English `detail` is never shown.
 */
export function describeCustomerProblem(
  status: number,
  problem: ProblemDetails,
): MessageDescriptor {
  return describeProblem(status, problem);
}

/**
 * The status line of a screen: always in the page (a live region announces changes of a region that was already there),
 * focusable so the focus can move to it after an action.
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

/** Previous and next page as links (the page is in the URL); the range is spelled out for assistive technology too. */
export function CustomerPager({
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
    <nav aria-label={t("customer.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("customer.list.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("customer.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("customer.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}
