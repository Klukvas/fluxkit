import type { BannerLayout, BannerState, BannerTone } from "@fluxkit/core";
import type { BannerPicture, BannerWithPictures } from "./banners.repository.js";
import type { BannerResponse } from "./banners.schemas.js";

/** The public URL of an upload, built like `POST /admin/media/uploads` builds it (ADR 0028). */
export function pictureUrl(picture: BannerPicture, publicBaseUrl: string | undefined): string {
  return `${publicBaseUrl ?? ""}/${picture.storageKey}`;
}

function toPicture(picture: BannerPicture, publicBaseUrl: string | undefined) {
  return {
    uploadId: picture.uploadId,
    url: pictureUrl(picture, publicBaseUrl),
    width: picture.width,
    height: picture.height,
  };
}

/** Database rows -> admin API shape. The only place where banner column names meet admin API field names. */
export function toBannerResponse(
  { row, picture, localePictures }: BannerWithPictures,
  computed: {
    state: BannerState;
    shownOnStorefront: boolean;
    publicBaseUrl: string | undefined;
  },
): BannerResponse {
  return {
    id: row.id,
    // The CHECK constraints allow only these values.
    layout: row.layout as BannerLayout,
    title: row.title,
    text: row.text,
    imageAlt: row.imageAlt,
    image: toPicture(picture, computed.publicBaseUrl),
    images: [...localePictures].map(([locale, own]) => ({
      locale,
      ...toPicture(own, computed.publicBaseUrl),
    })),
    link: row.link,
    tone: row.tone as BannerTone,
    position: row.position,
    isActive: row.isActive,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    state: computed.state,
    shownOnStorefront: computed.shownOnStorefront,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
