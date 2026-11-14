import type { BlogPost } from "./blog-api";

/** Test-only (imported by the specs of this folder, never by the app): a stored post as the admin API answers it. */
export function postFixture(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    id: "7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    slug: "first-post",
    status: "draft",
    state: "draft",
    title: { uk: "Перший допис", en: "First post" },
    publishedAt: null,
    createdAt: "2026-11-13T08:00:00.000Z",
    updatedAt: "2026-11-13T09:00:00.000Z",
    slugLocked: false,
    excerpt: { uk: "Коротко", en: "In short" },
    body: { uk: "## Вступ\n\nТекст.", en: "## Intro\n\nText." },
    seoTitle: null,
    seoDescription: null,
    coverUploadId: null,
    cover: null,
    coverAlt: null,
    ...overrides,
  };
}

export const CONTENT = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

export const COVER = {
  uploadId: "11111111-2222-4333-8444-555555555555",
  url: "https://media.example.com/cover.webp",
  width: 1600,
  height: 900,
} as const;
