import { localInputToIso } from "../../areas/banners/banner-time";
import type { BlogPost, PublishBlogPostBody } from "./blog-api";

/*
 * The publish controls as data (pure): which actions a post's state offers and what each sends to
 * `POST /admin/blog/posts/{id}/publish` (`docs/api/features-blog.md`: without `publishedAt` the stored date, else now; a
 * future date schedules; unpublish keeps the date).
 */

export type PublishAction = "publishNow" | "publishWithDate" | "schedule" | "unpublish";

/** Whether the post's stored date is still ahead (by the browser's clock, only to choose what to offer and send). */
function storedDateAhead(post: Pick<BlogPost, "publishedAt">, now: number): boolean {
  return post.publishedAt !== null && Date.parse(post.publishedAt) > now;
}

/**
 * The actions of a post, in the order the panel shows them. A draft unpublished earlier with a date already past offers
 * "Publish again with the date" only: sent without a date it is live at once (by the server's clock), so a separate
 * "Publish now" would do the same.
 */
export function publishActions(
  post: Pick<BlogPost, "state" | "publishedAt">,
  now: number,
): PublishAction[] {
  switch (post.state) {
    case "draft":
      if (post.publishedAt === null) return ["publishNow", "schedule"];
      return storedDateAhead(post, now)
        ? ["publishNow", "publishWithDate", "schedule"]
        : ["publishWithDate", "schedule"];
    case "scheduled":
      return ["publishNow", "schedule", "unpublish"];
    case "published":
      return ["unpublish"];
  }
}

/**
 * "Publish now". Without a stored date, or with one already past, no date is sent and the server's clock decides (the API
 * keeps a past stored date, which is live at once). Only a stored date still ahead (a scheduled post, or one unpublished
 * while scheduled) needs a date to go live now: the API has no "now" for it, so this moment of the browser's clock is sent
 * (a clock running ahead leaves the post scheduled for that difference; the panel shows the state the API answers).
 */
export function publishNowBody(
  post: Pick<BlogPost, "publishedAt">,
  now: number,
): PublishBlogPostBody {
  return storedDateAhead(post, now) ? { publishedAt: new Date(now).toISOString() } : {};
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
