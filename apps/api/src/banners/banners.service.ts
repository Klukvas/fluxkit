import { Inject, Injectable } from "@nestjs/common";
import {
  bannerWindowState,
  checkBannerContent,
  checkBannerCount,
  checkBannerImageLocales,
  checkBannerLink,
  checkBannerOrder,
  checkBannerWindow,
  selectLiveBanners,
  type BannerLayout,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { emptyToNull } from "../catalog/shared/text.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { translatePostgresError } from "../common/postgres-errors.js";
import { notFound, ruleViolation, validationFailed, type FieldError } from "../common/problem.js";
import { withTransaction, type DbExecutor } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import type { I18nText } from "../database/schema/index.js";
import { MediaAttachService } from "../media/media-attach.service.js";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import { toBannerResponse } from "./banners.mapper.js";
import {
  BannersRepository,
  type BannerRow,
  type BannerWithPictures,
} from "./banners.repository.js";
import type {
  BannerList,
  BannerResponse,
  CreateBannerBody,
  ReorderBannersBody,
  UpdateBannerBody,
} from "./banners.schemas.js";

/** The stored state of a banner after a create or a PATCH: what the rules of core check. */
interface BannerState {
  layout: BannerLayout;
  title: I18nText | null;
  text: I18nText | null;
  imageAlt: I18nText | null;
  link: string;
  startsAt: Date | null;
  endsAt: Date | null;
  imageUploadId: string;
  images: readonly { locale: string; imageUploadId: string }[];
}

/**
 * Admin rules of the home banners (ADR 0046). Writes run in one transaction each: the core rules check the resulting
 * state, every picture of the banner is marked attached in the same transaction (`markAttachedByIds`, so job 7 never
 * deletes it), and creates and reorders hold the list lock (the 50 cap, the next position, the current set). No audit
 * event (owner decision 2026-11-05, like catalog edits) and no domain event.
 */
@Injectable()
export class BannersService {
  constructor(
    private readonly banners: BannersRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(MEDIA_CONFIG) private readonly media: MediaConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MediaAttachService) private readonly mediaAttachments: MediaAttachService,
  ) {}

  async list(): Promise<BannerList> {
    return { items: this.toResponses(await this.banners.listWithPictures()) };
  }

  async get(id: string): Promise<BannerResponse> {
    const all = await this.banners.listWithPictures();
    const found = all.find(({ row }) => row.id === id);
    if (found === undefined) {
      throw notFound("Banner");
    }
    return this.toResponse(found, this.shownIds(all));
  }

  async create(body: CreateBannerBody): Promise<BannerResponse> {
    const state: BannerState = {
      layout: body.layout,
      title: emptyToNull(body.title),
      text: emptyToNull(body.text),
      imageAlt: emptyToNull(body.imageAlt),
      link: body.link,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      imageUploadId: body.imageUploadId,
      images: body.images,
    };
    this.assertValid(state, body.images);
    const id = await this.write(async (tx) => {
      await this.banners.lockList(tx);
      const allowed = checkBannerCount(await this.banners.count(tx));
      if (!allowed.ok) {
        throw ruleViolation(
          "A shop keeps at most 50 banners; delete one before adding another.",
          allowed.reason,
        );
      }
      await this.markPicturesAttached(tx, state);
      const row = await this.banners.insert(tx, {
        ...this.columnsOf(state),
        tone: body.tone,
        isActive: body.isActive,
        position: await this.banners.nextPosition(tx),
      });
      await this.banners.replaceImages(tx, row.id, state.images);
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, body: UpdateBannerBody): Promise<BannerResponse> {
    await this.write(async (tx) => {
      const existing = await this.banners.findForUpdate(tx, id);
      if (existing === undefined) {
        throw notFound("Banner");
      }
      const state = await this.mergedState(tx, existing, body);
      this.assertValid(state, body.images ?? []);
      await this.markPicturesAttached(tx, state);
      await this.banners.update(tx, id, {
        ...this.columnsOf(state),
        ...(body.tone === undefined ? {} : { tone: body.tone }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      });
      // A replaced or removed own picture simply stops being referenced; job 7 never deletes it (it stays attached).
      if (body.images !== undefined) {
        await this.banners.replaceImages(tx, id, state.images);
      }
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    if (!(await this.banners.delete(id))) {
      throw notFound("Banner");
    }
  }

  async reorder(body: ReorderBannersBody): Promise<BannerList> {
    await this.write(async (tx) => {
      await this.banners.lockList(tx);
      const checked = checkBannerOrder(await this.banners.ids(tx), body.ids);
      if (!checked.ok) {
        throw validationFailed([
          {
            path: "ids",
            code: checked.reason,
            message: "List every banner exactly once, in the new order.",
          },
        ]);
      }
      await this.banners.setPositions(tx, body.ids);
    });
    return this.list();
  }

  /** The PATCH result: given fields win; switching to the `image` layout clears a stored title and text. */
  private async mergedState(
    tx: DbExecutor,
    existing: BannerRow,
    body: UpdateBannerBody,
  ): Promise<BannerState> {
    const layout = (body.layout ?? existing.layout) as BannerLayout;
    const keptText = (stored: I18nText | null): I18nText | null =>
      layout === "image" ? null : stored;
    const images = body.images ?? (await this.banners.images(tx, existing.id));
    return {
      layout,
      title: body.title === undefined ? keptText(existing.title) : emptyToNull(body.title),
      text: body.text === undefined ? keptText(existing.text) : emptyToNull(body.text),
      imageAlt: body.imageAlt === undefined ? existing.imageAlt : emptyToNull(body.imageAlt),
      link: body.link ?? existing.link,
      startsAt: body.startsAt === undefined ? existing.startsAt : body.startsAt,
      endsAt: body.endsAt === undefined ? existing.endsAt : body.endsAt,
      imageUploadId: body.imageUploadId ?? existing.imageUploadId,
      images,
    };
  }

  /** Every field error of the resulting state at once: texts, link, window and the locales of the own pictures. */
  private assertValid(state: BannerState, requestedImages: readonly { locale: string }[]): void {
    const errors: FieldError[] = checkBannerContent(state, this.locale).map((error) => ({
      path: error.path,
      code: error.code,
      ...(error.limit === undefined
        ? {}
        : { message: `At most ${String(error.limit)} characters.` }),
    }));
    const link = checkBannerLink(state.link, this.locale.locales);
    if (!link.ok) {
      errors.push({
        path: "link",
        code: "invalid_link",
        message: `Use a storefront path without the language (/catalog) or an https:// address (${link.reason}).`,
      });
    }
    errors.push(...checkBannerWindow(state.startsAt, state.endsAt));
    errors.push(
      ...checkBannerImageLocales(
        requestedImages.map(({ locale }) => locale),
        this.locale.locales,
      ),
    );
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }

  /** The default picture and every own picture: `upload_not_found` at the request field of a missing one. */
  private markPicturesAttached(tx: DbExecutor, state: BannerState): Promise<void> {
    return this.mediaAttachments.markAttachedByIds(tx, [
      { path: "imageUploadId", id: state.imageUploadId },
      ...state.images.map((image, index) => ({
        path: `images.${String(index)}.imageUploadId`,
        id: image.imageUploadId,
      })),
    ]);
  }

  private columnsOf(state: BannerState) {
    return {
      layout: state.layout,
      title: state.title,
      text: state.text,
      imageAlt: state.imageAlt,
      imageUploadId: state.imageUploadId,
      link: state.link,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
    };
  }

  private async write<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.database, work);
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  private shownIds(all: readonly BannerWithPictures[]): ReadonlySet<string> {
    const now = this.clock.now();
    return new Set(
      selectLiveBanners(
        all.map(({ row }) => row),
        now,
      ).map((row) => row.id),
    );
  }

  private toResponses(all: readonly BannerWithPictures[]): BannerResponse[] {
    const shown = this.shownIds(all);
    return all.map((entry) => this.toResponse(entry, shown));
  }

  private toResponse(entry: BannerWithPictures, shown: ReadonlySet<string>): BannerResponse {
    return toBannerResponse(entry, {
      state: bannerWindowState(this.clock.now(), entry.row),
      shownOnStorefront: shown.has(entry.row.id),
      publicBaseUrl: this.media.publicBaseUrl,
    });
  }
}
