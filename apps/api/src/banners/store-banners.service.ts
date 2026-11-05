import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  resolveBannerPicture,
  resolveText,
  resolveTextWithFallback,
  selectLiveBanners,
  type BannerLayout,
  type BannerTone,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { validationFailed } from "../common/problem.js";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import { pictureUrl } from "./banners.mapper.js";
import { BannersRepository } from "./banners.repository.js";
import type { StoreBanner, StoreBannerList } from "./banners.schemas.js";

/**
 * `GET /store/banners` (ADR 0046): the banners live now (active and inside their window, core `selectLiveBanners`), at
 * most 3, by position then id, with public fields only: never the active flag, the window, the position, timestamps or
 * upload ids. Texts fall back per field to the default locale; the picture is the locale's own one, else the default.
 */
@Injectable()
export class StoreBannersService {
  private readonly logger = new Logger(StoreBannersService.name);

  constructor(
    private readonly banners: BannersRepository,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(MEDIA_CONFIG) private readonly media: MediaConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(requestedLocale: string | undefined): Promise<StoreBannerList> {
    const locale = requestedLocale ?? this.locale.defaultLocale;
    if (!this.locale.locales.includes(locale)) {
      throw validationFailed([
        {
          path: "locale",
          code: "invalid_value",
          message: `Must be one of: ${this.locale.locales.join(", ")}.`,
        },
      ]);
    }
    const active = await this.banners.listWithPictures({ activeOnly: true, locale });
    const live = selectLiveBanners(
      active.map((entry) => ({ ...entry.row, entry })),
      this.clock.now(),
    );
    return { items: live.map(({ entry }) => this.toStoreBanner(entry, locale)) };
  }

  private toStoreBanner(
    {
      row,
      picture,
      localePictures,
    }: Awaited<ReturnType<BannersRepository["listWithPictures"]>>[number],
    locale: string,
  ): StoreBanner {
    const { defaultLocale } = this.locale;
    const layout = row.layout as BannerLayout;
    const shown = resolveBannerPicture(picture, localePictures, locale);
    let title: string | null = null;
    if (layout === "card") {
      title = resolveTextWithFallback(row.title, locale, defaultLocale) ?? null;
      if (title === null) {
        // Only data written around the service can lack a title; degrade to an empty one, like the catalog reads.
        this.logger.warn(`Banner ${row.id} has no title in any locale.`);
        title = "";
      }
    }
    return {
      id: row.id,
      layout,
      title,
      text: layout === "card" ? (resolveText(row.text, locale, defaultLocale) ?? null) : null,
      href: row.link,
      tone: row.tone as BannerTone,
      image: {
        url: pictureUrl(shown, this.media.publicBaseUrl),
        width: shown.width,
        height: shown.height,
        alt: resolveText(row.imageAlt, locale, defaultLocale) ?? null,
      },
    };
  }
}
