import { localInputToIso } from "../../areas/banners/banner-time";
import type { BlogPost, PublishBlogPostBody } from "./blog-api";

/*
 * The publish controls as data (pure): which actions a post's state offers and what each sends to
 * `POST /admin/blog/posts/{id}/publish` (`docs/api/features-blog.md`: without `publishedAt` the stored date, else now; a
 * future date schedules; unpublish keeps the date).
 */

export type PublishAction = "publishNow" | "publishWithDate" | "schedule" | "unpublish";

/** The actions of a post, in the order the panel shows them. */
export function publishActions(post: Pick<BlogPost, "state" | "publishedAt">): PublishAction[] {
  switch (post.state) {
    case "draft":
      return post.publishedAt === null
        ? ["publishNow", "schedule"]
        : ["publishWithDate", "publishNow", "schedule"];
    case "scheduled":
      return ["publishNow", "schedule", "unpublish"];
    case "published":
      return ["unpublish"];
  }
}

/**
 * "Publish now": a post that never had a date sends no date (the server's clock decides); a post with a stored date (a
 * scheduled one, or one unpublished earlier) sends this moment, else the stored date would be kept.
 */
export function publishNowBody(
  post: Pick<BlogPost, "publishedAt">,
  now: number,
): PublishBlogPostBody {
  return post.publishedAt === null ? {} : { publishedAt: new Date(now).toISOString() };
}

/** "Publish again with its date": the stored date, kept by the API when no date is sent. */
export const PUBLISH_WITH_STORED_DATE: PublishBlogPostBody = {};

/** The API's bounds of a publish date: [2000-01-01, 2200-01-01) UTC. */
const MIN_INSTANT = Date.UTC(2000, 0, 1);
const MAX_INSTANT = Date.UTC(2200, 0, 1);

export type ScheduleInput =
  | { ok: true; body: PublishBlogPostBody; future: boolean }
  | { ok: false; reason: "required" | "invalid" | "outOfRange" };

/** The chosen date and time (`datetime-local`, in `timeZone`) as the publish body; a past time publishes with that date. */
export function scheduleBody(text: string, timeZone: string, now: number): ScheduleInput {
  const parsed = localInputToIso(text, timeZone);
  if (!parsed.ok) return { ok: false, reason: "invalid" };
  if (parsed.value === null) return { ok: false, reason: "required" };
  if (parsed.instant < MIN_INSTANT || parsed.instant >= MAX_INSTANT) {
    return { ok: false, reason: "outOfRange" };
  }
  return { ok: true, body: { publishedAt: parsed.value }, future: parsed.instant > now };
}
