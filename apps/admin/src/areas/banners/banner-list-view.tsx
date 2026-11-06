import type { AdminHomeBanner, AdminHomeBannerState } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  StatusBadge,
  cn,
  type StatusTone,
  type Translator,
} from "@fluxkit/ui";
import { useState, type DragEvent } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { safeHttpUrl } from "../../lib/safe-http-url";
import { PATHS, buildPath } from "../../router/paths";
import { primaryLinkClass } from "../catalog-dictionaries/dictionary-frame";
import type { ContentLocales } from "../catalog-dictionaries/form-parts";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import { BANNER_LIMITS } from "./banner-rules";
import { bannerVisibility } from "./banner-visibility";

const STATE_TONE: Record<AdminHomeBannerState, StatusTone> = {
  live: "success",
  scheduled: "neutral",
  expired: "neutral",
  inactive: "neutral",
};

const linkClass = "font-semibold text-foreground underline underline-offset-4";

/** The name of a banner in lists, dialogs and announcements: its title (`card`) or description (`image`) in the UI language. */
export function bannerName(
  t: Translator,
  banner: AdminHomeBanner,
  uiLocale: string,
  content: ContentLocales,
): string {
  const text = resolveLocalized(
    banner.layout === "card" ? banner.title : banner.imageAlt,
    uiLocale,
    content.defaultLocale,
  );
  return text === "" ? t("banners.list.untitled") : text;
}

/** The window of a banner in words, in the UI language and the browser's time zone. */
export function windowText(t: Translator, banner: AdminHomeBanner, uiLocale: string): string {
  const start = banner.startsAt === null ? null : formatDateTime(banner.startsAt, uiLocale);
  const end = banner.endsAt === null ? null : formatDateTime(banner.endsAt, uiLocale);
  if (start === null && end === null) return t("banners.list.noWindow");
  if (end === null) return t("banners.list.from", { start: start as string });
  if (start === null) return t("banners.list.until", { end });
  return t("banners.list.between", { start, end });
}

/** The ids of a row's move buttons (the focus goes back to one after a move). */
export function moveButtonId(id: string, direction: "up" | "down"): string {
  return `banner-${direction}-${id}`;
}

export interface BannerListViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  banners: readonly AdminHomeBanner[];
  canWrite: boolean;
  /** A reorder runs: the move buttons and dragging do nothing (they stay focusable). */
  busy: boolean;
  onMove: (index: number, delta: -1 | 1) => void;
  onDrop: (from: number, to: number) => void;
  onDelete: (banner: AdminHomeBanner) => void;
}

/**
 * The banners in their order (plan D5): picture, name, state as text, window, the "shown on the storefront" mark of the
 * first 3 live ones, and for a `catalog.write` admin the move buttons (the keyboard path), dragging a row (a pointer
 * enhancement only) and delete. Each row is an `li` of an ordered list, so its position is announced.
 */
export function BannerListView({
  t,
  uiLocale,
  content,
  banners,
  canWrite,
  busy,
  onMove,
  onDrop,
  onDelete,
}: BannerListViewProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const full = banners.length >= BANNER_LIMITS.maxStored;
  if (banners.length === 0) {
    return (
      <EmptyState
        title={t("banners.list.emptyTitle")}
        description={t("banners.list.emptyBody")}
        action={
          canWrite ? (
            <Link to={PATHS.bannerNew} className={primaryLinkClass}>
              {t("banners.new")}
            </Link>
          ) : undefined
        }
      />
    );
  }
  const draggable = canWrite && banners.length > 1;
  const visibility = bannerVisibility(banners, BANNER_LIMITS.maxShown);
  return (
    <div className="flex flex-col gap-4">
      {full ? (
        <Alert variant="warning" title={t("banners.list.capTitle")}>
          <p>{t("banners.list.capBody", { max: BANNER_LIMITS.maxStored })}</p>
        </Alert>
      ) : null}
      <p className="text-muted-foreground">
        {t("banners.list.shownRule", { shown: BANNER_LIMITS.maxShown })}
      </p>
      {draggable ? (
        <p className="text-sm text-muted-foreground">{t("banners.list.dragHint")}</p>
      ) : null}
      <ol aria-label={t("banners.list.label")} className="flex flex-col gap-3">
        {banners.map((banner, index) => {
          const name = bannerName(t, banner, uiLocale, content);
          const own = banner.images.find((image) => image.locale === uiLocale);
          const thumbnail = safeHttpUrl((own ?? banner.image).url);
          const first = index === 0;
          const last = index === banners.length - 1;
          const drop = (event: DragEvent<HTMLLIElement>) => {
            event.preventDefault();
            const from = dragging;
            setDragging(null);
            setOver(null);
            if (from !== null && !busy) onDrop(from, index);
          };
          return (
            <li
              key={banner.id}
              data-banner-id={banner.id}
              draggable={draggable && !busy ? true : undefined}
              onDragStart={
                draggable
                  ? (event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", banner.id);
                      setDragging(index);
                    }
                  : undefined
              }
              onDragOver={
                draggable
                  ? (event) => {
                      if (dragging === null) return;
                      event.preventDefault();
                      setOver(index);
                    }
                  : undefined
              }
              onDragEnd={
                draggable
                  ? () => {
                      setDragging(null);
                      setOver(null);
                    }
                  : undefined
              }
              onDrop={draggable ? drop : undefined}
              className={cn(
                "flex flex-col gap-4 rounded-md border bg-background p-4 sm:flex-row sm:items-center",
                // The drop target while a row is dragged over it (a pointer hint; the text of the rows does not change).
                over === index && dragging !== null && dragging !== index
                  ? "border-primary"
                  : "border-border",
                draggable ? "cursor-grab" : null,
              )}
            >
              <span className="w-8 shrink-0 text-lg font-semibold text-muted-foreground">
                {t("banners.list.position", { position: index + 1 })}
              </span>
              {thumbnail === null ? (
                <span className="block aspect-2/1 w-32 shrink-0 rounded-md bg-muted" />
              ) : (
                <img
                  src={thumbnail}
                  alt=""
                  width={(own ?? banner.image).width}
                  height={(own ?? banner.image).height}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="aspect-2/1 w-32 shrink-0 rounded-md border border-border bg-muted object-cover"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h2 className="break-words">
                  <Link to={buildPath(PATHS.bannerDetail, { id: banner.id })} className={linkClass}>
                    {name}
                  </Link>
                </h2>
                <p className="flex flex-wrap items-center gap-2">
                  {/* A live banner after the first 3 live ones is NOT on the home page: its state says so, never "Live now". */}
                  {visibility[index] === "liveNotShown" ? (
                    <StatusBadge
                      tone="warning"
                      label={t("banners.list.liveNotShown", { shown: BANNER_LIMITS.maxShown })}
                    />
                  ) : (
                    <StatusBadge
                      tone={STATE_TONE[banner.state]}
                      label={t(`banners.state.${banner.state}`)}
                    />
                  )}
                  {visibility[index] === "shown" ? (
                    <Badge variant="success">{t("banners.list.shown")}</Badge>
                  ) : null}
                  <span className="text-sm text-muted-foreground">
                    {t(`banners.layout.${banner.layout}`)}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">{windowText(t, banner, uiLocale)}</p>
                {visibility[index] === "behindShown" ? (
                  <p className="text-sm text-foreground">
                    {t("banners.list.behindShown", { shown: BANNER_LIMITS.maxShown })}
                  </p>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    id={moveButtonId(banner.id, "up")}
                    variant="secondary"
                    disabled={first}
                    aria-disabled={busy || undefined}
                    aria-label={t("banners.list.moveUpLabel", { name })}
                    onClick={() => {
                      if (!busy) onMove(index, -1);
                    }}
                  >
                    {t("banners.list.moveUp")}
                  </Button>
                  <Button
                    id={moveButtonId(banner.id, "down")}
                    variant="secondary"
                    disabled={last}
                    aria-disabled={busy || undefined}
                    aria-label={t("banners.list.moveDownLabel", { name })}
                    onClick={() => {
                      if (!busy) onMove(index, 1);
                    }}
                  >
                    {t("banners.list.moveDown")}
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={t("banners.list.deleteLabel", { name })}
                    onClick={() => onDelete(banner)}
                  >
                    {t("banners.list.delete")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
