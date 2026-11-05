import { BANNER_LAYOUTS, BANNER_LIMITS, BANNER_STATES, BANNER_TONES } from "@fluxkit/core";
import { z } from "zod";
import { i18nTextSchema } from "../catalog/shared/i18n-validation.js";
import { timestampSchema, uuidSchema } from "../common/openapi-formats.js";

// Schemas check structure and static limits. The layout rules, the link rule, the window and the picture locales depend
// on configuration (content locales) or on the stored banner (PATCH), so they run in the service with the core rules of
// `packages/core/src/content` (ADR 0046).

const uploadIdSchema = z.guid().meta({ format: "uuid", description: "Id of an upload." });

const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .meta({
    description:
      "ISO 8601 with `Z` or an offset, between 2000-01-01 and 2200-01-01; stored and returned in UTC.",
  });

const localeImageSchema = z.strictObject({
  locale: z.string().min(1).max(16).meta({ description: "One of the content locales." }),
  imageUploadId: uploadIdSchema,
});

const imagesSchema = z.array(localeImageSchema).max(16).meta({
  description:
    "The banner's own picture per content locale; a locale without one shows `imageUploadId`. Replaces the whole set.",
});

// No zod `max`: an overlong link gets the same `invalid_link` as every other refused link (the body size limit bounds it).
const linkSchema = z.string().meta({
  maxLength: BANNER_LIMITS.linkMaxLength,
  description:
    "A storefront path without the locale prefix (`/catalog`) or an `https://` address. Refused as `invalid_link`.",
});

const textSchema = i18nTextSchema.nullable();

/** `POST /admin/banners`. Appended at the end of the order. */
export const createBannerSchema = z.strictObject({
  layout: z.enum(BANNER_LAYOUTS).default("card"),
  title: textSchema.optional(),
  text: textSchema.optional(),
  imageAlt: textSchema.optional(),
  imageUploadId: uploadIdSchema,
  images: imagesSchema.default([]),
  link: linkSchema,
  tone: z.enum(BANNER_TONES).default("surface"),
  isActive: z.boolean().default(false),
  startsAt: instantSchema.nullable().default(null),
  endsAt: instantSchema.nullable().default(null),
});

/** `PATCH /admin/banners/{id}`: only the listed fields change; a text map replaces the whole map, `null` clears it. */
export const updateBannerSchema = z.strictObject({
  layout: z.enum(BANNER_LAYOUTS).optional(),
  title: textSchema.optional(),
  text: textSchema.optional(),
  imageAlt: textSchema.optional(),
  imageUploadId: uploadIdSchema.optional(),
  images: imagesSchema.optional(),
  link: linkSchema.optional(),
  tone: z.enum(BANNER_TONES).optional(),
  isActive: z.boolean().optional(),
  startsAt: instantSchema.nullable().optional(),
  endsAt: instantSchema.nullable().optional(),
});

/** `PUT /admin/banners/order`: exactly the current banners, each once, in the new order. */
export const reorderBannersSchema = z.strictObject({
  ids: z.array(z.guid().meta({ format: "uuid" })).max(BANNER_LIMITS.maxStored),
});

const pictureSchema = z.object({
  uploadId: uuidSchema,
  url: z.string().meta({ description: "`MEDIA_PUBLIC_BASE_URL` + `/` + the storage key." }),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const bannerResponseSchema = z.object({
  id: uuidSchema,
  layout: z.enum(BANNER_LAYOUTS),
  title: i18nTextSchema.nullable(),
  text: i18nTextSchema.nullable(),
  imageAlt: i18nTextSchema.nullable(),
  image: pictureSchema.meta({ description: "The default picture." }),
  images: z
    .array(pictureSchema.extend({ locale: z.string() }))
    .meta({ description: "Own pictures per locale, ordered by locale." }),
  link: z.string(),
  tone: z.enum(BANNER_TONES),
  position: z.number().int(),
  isActive: z.boolean(),
  startsAt: timestampSchema.nullable(),
  endsAt: timestampSchema.nullable(),
  state: z.enum(BANNER_STATES).meta({
    description:
      "`live` (active, inside its window), `scheduled` (before `startsAt`), `expired` (from `endsAt` on), `inactive`.",
  }),
  shownOnStorefront: z
    .boolean()
    .meta({ description: "One of the first 3 live banners, which `GET /store/banners` returns." }),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const bannerListSchema = z.object({
  items: z
    .array(bannerResponseSchema)
    .meta({ description: "Every banner (at most 50), by position, then id." }),
});

export const storeBannersQuerySchema = z.strictObject({
  locale: z
    .string()
    .min(1)
    .max(16)
    .optional()
    .meta({ description: "One of the configured locales. Missing means the default locale." }),
});

export const storeBannerSchema = z.object({
  id: uuidSchema,
  layout: z.enum(BANNER_LAYOUTS),
  title: z.string().nullable().meta({ description: "`null` for the `image` layout." }),
  text: z.string().nullable(),
  href: z.string().meta({
    description: "A storefront path without the locale prefix, or an `https://` address.",
  }),
  tone: z.enum(BANNER_TONES),
  image: z.object({
    url: z.string(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    alt: z
      .string()
      .nullable()
      .meta({ description: "`null` = a decorative picture (only for the `card` layout)." }),
  }),
});

export const storeBannerListSchema = z.object({
  items: z.array(storeBannerSchema).max(BANNER_LIMITS.maxShown),
});

export type CreateBannerBody = z.output<typeof createBannerSchema>;
export type UpdateBannerBody = z.output<typeof updateBannerSchema>;
export type ReorderBannersBody = z.output<typeof reorderBannersSchema>;
export type BannerResponse = z.output<typeof bannerResponseSchema>;
export type BannerList = z.output<typeof bannerListSchema>;
export type StoreBannersQuery = z.output<typeof storeBannersQuerySchema>;
export type StoreBanner = z.output<typeof storeBannerSchema>;
export type StoreBannerList = z.output<typeof storeBannerListSchema>;
