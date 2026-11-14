import {
  ActionButton,
  Alert,
  OptionPicker,
  QuantityInput,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import type { FormEvent, Ref } from "react";
import { MAX_LINE_QUANTITY, MIN_LINE_QUANTITY, type addRoom } from "../lib/add-to-cart";
import { localizedHref } from "../lib/locale-path";
import {
  chosenValue,
  hasOptionPicker,
  isValueAvailable,
  isValueSoldOut,
  selectValue,
  type Selection,
} from "../lib/variant-matcher";
import type { ProductDetail } from "@fluxkit/api-client";
import { focusRing } from "./styles";

export type AddStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "added" }
  | { state: "failed"; messageKey: string; values?: Readonly<Record<string, number>> };

export const LIMIT_NOTE_ID = "product-quantity-limit";

interface Props {
  product: Pick<ProductDetail, "id" | "title" | "options" | "variants" | "price" | "availability">;
  t: Translator;
  locale: Locale;
  chosen: string;
  selection: Selection;
  optionGuide: { href: string; label: string } | null;
  otherOnSale: boolean;
  shownQuantity: number;
  room: number;
  pending: boolean;
  atLimit: boolean;
  purchasable: boolean;
  ready: boolean;
  soldOut: boolean;
  inCart: number;
  stock: ReturnType<typeof addRoom>["stock"];
  status: AddStatus;
  formRef: Ref<HTMLFormElement>;
  addButtonRef: Ref<HTMLButtonElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelection: (selection: Selection) => void;
  onQuantity: (quantity: number) => void;
}

/** Presentational form; its parent owns submission, draft quantity and drawer focus-return targets. */
export function ProductPurchaseForm({
  product,
  t,
  locale,
  chosen,
  selection,
  optionGuide,
  otherOnSale,
  shownQuantity,
  room,
  pending,
  atLimit,
  purchasable,
  ready,
  soldOut,
  inCart,
  stock,
  status,
  formRef,
  addButtonRef,
  onSubmit,
  onSelection,
  onQuantity,
}: Props) {
  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={(event) => {
        if (!purchasable || !ready || pending) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      {/* The chosen values in words (UX round 2, batch 3A item 7): the page starts from the first sellable variant, and a
                checked radio alone was easy to miss. API names only, in option order; no plural, so one message fits every count. */}
      {hasOptionPicker(product) && chosen !== "" ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p id="product-chosen" className="text-sm text-foreground">
            {t("productChoice.selected", { values: chosen })}
          </p>
          {optionGuide === null ? null : (
            <Link
              href={optionGuide.href}
              className={`inline-flex min-h-6 items-center text-sm text-foreground underline underline-offset-4 ${focusRing}`}
            >
              {optionGuide.label}
            </Link>
          )}
        </div>
      ) : null}
      {hasOptionPicker(product)
        ? product.options.map((option) => (
            <OptionPicker
              key={option.id}
              name={`${product.id}-${option.code}`}
              legend={option.name}
              values={option.values.map((value) => ({
                value: value.code,
                label: value.name,
                disabled: !isValueAvailable(product, selection, option.code, value.code),
                soldOut: isValueSoldOut(product, selection, option.code, value.code),
              }))}
              soldOutLabel={t("product.soldOut")}
              selected={chosenValue(selection, option.code) ?? null}
              onChange={(valueCode) => {
                const next = selectValue(product, selection, option.code, valueCode);
                onSelection(next);
              }}
            />
          ))
        : null}
      {otherOnSale && hasOptionPicker(product) ? (
        <p className="text-sm text-muted-foreground">{t("product.soldOut.hint")}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <QuantityInput
            id="product-quantity"
            label={t("product.quantity.label")}
            decreaseLabel={t("product.quantity.decrease")}
            increaseLabel={t("product.quantity.increase")}
            min={MIN_LINE_QUANTITY}
            max={Math.max(MIN_LINE_QUANTITY, room)}
            value={shownQuantity}
            onChange={onQuantity}
            disabled={pending || atLimit}
          />
          {/* Full width and 48 px on phones (review N8). While adding it stays enabled for the focus (`aria-disabled`,
                    review A1): a disabled button drops the keyboard focus to the page body; `submit` ignores a repeat. */}
          <ActionButton
            state={pending ? "loading" : status.state === "added" ? "done" : "idle"}
            idleLabel={soldOut ? t("availability.out_of_stock") : t("product.addToCart")}
            loadingLabel={t("product.adding")}
            doneLabel={t("product.card.added")}
            ref={addButtonRef}
            type="submit"
            disabled={!ready}
            aria-disabled={!purchasable || !ready || pending}
            data-ready={ready ? undefined : "false"}
            className="min-h-12 w-full aria-disabled:opacity-50 aria-disabled:hover:bg-primary sm:min-h-11 sm:w-auto lg:min-h-12 lg:flex-1"
            aria-describedby={
              atLimit ? `product-availability ${LIMIT_NOTE_ID}` : "product-availability"
            }
          />
        </div>
        <noscript>
          <p className="text-sm text-muted-foreground">{t("productReady.noScript")}</p>
        </noscript>
        {atLimit && stock !== null ? (
          <p id={LIMIT_NOTE_ID} className="flex flex-wrap gap-x-2 text-sm text-foreground">
            <span>
              {/* No count, or 0 (a default location without stock): "more than the shop has", never "only 0". */}
              {stock.available === null || stock.available === 0
                ? t("product.quantity.stockShort", { count: inCart })
                : t.plural("product.quantity.stockLimit", stock.available, {
                    inCart,
                  })}
            </span>
            <Link
              href={localizedHref(locale, "/cart")}
              className={`inline-flex min-h-6 items-center underline underline-offset-4 ${focusRing}`}
            >
              {t("product.viewCart")}
            </Link>
          </p>
        ) : atLimit ? (
          <p id={LIMIT_NOTE_ID} className="text-sm text-foreground">
            {t("product.quantity.atLimit", {
              count: inCart,
              max: MAX_LINE_QUANTITY,
              room: 0,
            })}
          </p>
        ) : inCart > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("product.quantity.inCart", { count: inCart })}
          </p>
        ) : null}
        <div role="status" className="flex flex-col gap-2">
          {status.state === "pending" ? <p>{t("product.adding")}</p> : null}
          {status.state === "added" ? <p>{t("product.added")}</p> : null}
        </div>
        {status.state === "failed" ? (
          <Alert variant="danger">{t(status.messageKey, status.values)}</Alert>
        ) : null}
      </div>
    </form>
  );
}
