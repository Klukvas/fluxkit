import type { AdminHomeBanner } from "@fluxkit/api-client";

/** Test-only (imported by the specs of this folder, never by the app): a stored banner as the admin API answers it. */
export function bannerFixture(overrides: Partial<AdminHomeBanner> = {}): AdminHomeBanner {
  return {
    id: "6c1b4f7e-2d8a-4b9e-9f3a-0a1b2c3d4e5f",
    layout: "card",
    title: { uk: "Весняний розпродаж", en: "Spring sale" },
    text: { uk: "Знижки до третини", en: "Up to a third off" },
    imageAlt: null,
    image: {
      uploadId: "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c",
      url: "https://media.example.com/aa.webp",
      width: 1280,
      height: 640,
    },
    images: [],
    link: "/catalog",
    tone: "surface",
    position: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    state: "live",
    shownOnStorefront: true,
    createdAt: "2026-11-05T10:00:00.000Z",
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  };
}

export const CONTENT = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

export const PICTURE = {
  uploadId: "11111111-2222-4333-8444-555555555555",
  url: "https://media.example.com/bb.png",
  width: 1600,
  height: 800,
} as const;
