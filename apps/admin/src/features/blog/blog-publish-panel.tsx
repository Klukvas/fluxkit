import { Button, Field, Input, LiveRegion, type Translator } from "@fluxkit/ui";
import { useRef, useState, type FormEvent } from "react";
import { browserTimeZone } from "../../lib/date-range";
import { formatDateTime } from "../../lib/format";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { zoneLabel } from "../../areas/banners/banner-time";
import { FormErrorSummary, UnknownResultNotice } from "../../areas/catalog-dictionaries/form-parts";
import { useFormSubmit } from "../../areas/catalog-dictionaries/use-form-submit";
import { blogApi, type BlogPost, type PublishBlogPostBody } from "./blog-api";
import { blogProblemMapper } from "./blog-form";
import { StateBadge } from "./blog-list-view";
import {
  PUBLISH_WITH_STORED_DATE,
  publishActions,
  publishNowBody,
  scheduleBody,
} from "./blog-publish";

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What the status line says after a publish action. */
type PublishNotice = "published" | "scheduled" | "unpublished" | "unknown";

/** The sentence that says where the post stands. */
function stateSentence(t: Translator, post: BlogPost, uiLocale: string): string {
  const date = post.publishedAt === null ? "" : formatDateTime(post.publishedAt, uiLocale);
  switch (post.state) {
    case "published":
      return t("features.blog.publish.isPublished", { date });
    case "scheduled":
      return t("features.blog.publish.isScheduled", { date });
    case "draft":
      return post.publishedAt === null
        ? t("features.blog.publish.isDraft")
        : t("features.blog.publish.isDraftWithDate", { date });
  }
}

/**
 * Publish now, schedule (date and time in the browser's zone), unpublish (plan section 10). Shown to every reader; the
 * buttons only with `catalog.publish`. A form with unsaved changes locks every one of them: publishing sends nothing of the
 * form (the stored text would go live), and after any action the post is read again, which would replace the unsaved edits. A refusal (`translation_incomplete`: which language misses a title or a body) is listed in the
 * panel's summary; after a success the post is read again and the status line says what happened.
 */
export function BlogPublishPanel({
  t,
  uiLocale,
  post,
  canPublish,
  unsaved,
  onChanged,
}: {
  t: Translator;
  uiLocale: string;
  post: BlogPost;
  canPublish: boolean;
  /** The form has changes that are not saved. */
  unsaved: boolean;
  /** A publish action ended (or its answer was lost): read the post again. */
  onChanged: () => void;
}) {
  const [timeZone] = useState(browserTimeZone);
  const [when, setWhen] = useState("");
  const [whenError, setWhenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: PublishNotice; n: number } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const action = useFormSubmit([], blogProblemMapper(uiLocale));
  const actions = publishActions(post, Date.now());
  const locked = unsaved || action.state.busy;

  async function run(
    write: () => ReturnType<typeof blogApi.publishBlogPost>,
    done: Exclude<PublishNotice, "unknown"> | ((updated: BlogPost) => PublishNotice),
  ) {
    if (action.pending() || locked) return;
    setNotice(null);
    const outcome = await action.submit(write);
    if (outcome.kind === "ok") {
      const kind = typeof done === "function" ? done(outcome.data) : done;
      setNotice((current) => ({ kind, n: (current?.n ?? 0) + 1 }));
      focusAfterCommit(statusRef);
      onChanged();
    } else if (outcome.kind === "unknown") {
      setNotice((current) => ({ kind: "unknown", n: (current?.n ?? 0) + 1 }));
      focusAfterCommit(statusRef);
      onChanged();
    }
  }

  const publish = (body: PublishBlogPostBody) =>
    run(
      () => blogApi.publishBlogPost(post.id, body),
      (updated) => (updated.state === "scheduled" ? "scheduled" : "published"),
    );

  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = scheduleBody(when, timeZone, Date.now());
    if (!input.ok) {
      setWhenError(t(`features.blog.publish.when.${input.reason}`));
      focusAfterCommit("blog-publish-at");
      return;
    }
    setWhenError(null);
    void publish(input.body);
  }

  return (
    <section aria-labelledby="blog-publish-heading" className="flex flex-col gap-4">
      <h2 id="blog-publish-heading" className="text-lg font-semibold text-foreground">
        {t("features.blog.publish.heading")}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <StateBadge t={t} state={post.state} />
        <p className="text-foreground">{stateSentence(t, post, uiLocale)}</p>
      </div>
      <div ref={statusRef} tabIndex={-1} className={focusClass}>
        <LiveRegion>
          {notice === null ? null : notice.kind === "unknown" ? (
            <UnknownResultNotice t={t} />
          ) : (
            <p className="rounded-panel border border-success p-3 text-foreground">
              {t(`features.blog.publish.done.${notice.kind}`)}
            </p>
          )}
        </LiveRegion>
      </div>
      <FormErrorSummary t={t} summary={action.state.summary} summaryRef={action.summaryRef} />
      {!canPublish ? (
        <p className="text-sm text-muted-foreground">{t("features.blog.publish.noPermission")}</p>
      ) : (
        <>
          {unsaved ? (
            <p id="blog-publish-unsaved" className="text-sm font-medium text-warning">
              {t("features.blog.publish.saveFirst")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {actions.includes("publishNow") ? (
              <Button
                disabled={locked}
                aria-describedby={unsaved ? "blog-publish-unsaved" : undefined}
                onClick={() => void publish(publishNowBody(post, Date.now()))}
              >
                {t("features.blog.publish.now")}
              </Button>
            ) : null}
            {actions.includes("publishWithDate") && post.publishedAt !== null ? (
              <Button
                variant={actions.includes("publishNow") ? "secondary" : "primary"}
                disabled={locked}
                aria-describedby={unsaved ? "blog-publish-unsaved" : undefined}
                onClick={() => void publish(PUBLISH_WITH_STORED_DATE)}
              >
                {t("features.blog.publish.withDate", {
                  date: formatDateTime(post.publishedAt, uiLocale),
                })}
              </Button>
            ) : null}
            {actions.includes("unpublish") ? (
              <Button
                variant="secondary"
                // Locked like publishing: the post is read again afterwards, which would replace unsaved edits.
                disabled={locked}
                aria-describedby={unsaved ? "blog-publish-unsaved" : undefined}
                onClick={() => void run(() => blogApi.unpublishBlogPost(post.id), "unpublished")}
              >
                {t("features.blog.publish.unpublish")}
              </Button>
            ) : null}
          </div>
          {actions.includes("schedule") ? (
            <form
              method="post"
              noValidate
              onSubmit={schedule}
              className="flex flex-wrap items-end gap-3"
              aria-labelledby="blog-schedule-heading"
            >
              <h3 id="blog-schedule-heading" className="w-full font-semibold text-foreground">
                {t(
                  post.state === "scheduled"
                    ? "features.blog.publish.rescheduleHeading"
                    : "features.blog.publish.scheduleHeading",
                )}
              </h3>
              <Field
                id="blog-publish-at"
                label={t("features.blog.publish.when.label")}
                hint={t("features.blog.publish.when.hint", {
                  zone: zoneLabel(timeZone, Date.now()),
                })}
                error={whenError ?? undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    name="publishedAt"
                    value={when}
                    onChange={(event) => setWhen(event.target.value)}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="secondary"
                disabled={locked}
                aria-describedby={unsaved ? "blog-publish-unsaved" : undefined}
              >
                {t("features.blog.publish.schedule")}
              </Button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
