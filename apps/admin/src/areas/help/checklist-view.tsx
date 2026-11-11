import { Button, Card, Checkbox, StatusBadge, type StatusTone, type Translator } from "@fluxkit/ui";
import type { RefObject } from "react";
import { Link } from "react-router";
import { PATHS } from "../../router/paths";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import {
  CHECKLIST_STEPS,
  doneCount,
  type ChecklistFacts,
  type ChecklistPreferences,
  type ComputedStepId,
  type FactState,
  type ManualStepId,
} from "./checklist-model";
import { helpArticlePath, type ScreenRouteId } from "./help-model";
import { inlineLinkClass, standaloneLinkClass } from "../../views/links";

export type ChecklistFactsState =
  Exclude<ResourceFallbackState, { status: "ready" }> | { status: "ready"; data: ChecklistFacts };

/** Where the card is: the start page (with "hide") or the Help page (always there, with "show on the start page"). */
export type ChecklistPlace = "home" | "help";

const TONE: Record<FactState, StatusTone> = {
  done: "success",
  todo: "neutral",
  testOnly: "warning",
  noAccess: "neutral",
  failed: "danger",
};

export interface ChecklistViewProps {
  t: Translator;
  place: ChecklistPlace;
  /** The read of the facts: `ready` carries them; the other states show the shell's fallback with a retry. */
  facts: ChecklistFactsState;
  preferences: ChecklistPreferences;
  storageFailed: boolean;
  canOpen: (route: ScreenRouteId) => boolean;
  onRetry: () => void;
  onToggleManual: (step: ManualStepId, done: boolean) => void;
  onToggleShownOnHome: (shown: boolean) => void;
}

/** The ordered setup steps with their state, the article and the screen of each (markup only). */
export function ChecklistView({
  t,
  place,
  facts,
  preferences,
  storageFailed,
  canOpen,
  onRetry,
  onToggleManual,
  onToggleShownOnHome,
}: ChecklistViewProps) {
  const headingId = `checklist-title-${place}`;
  return (
    <Card className="flex flex-col gap-4">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-xl font-semibold text-foreground">
            {t("help.checklist.title")}
          </h2>
          <p className="max-w-prose text-muted-foreground">{t("help.checklist.intro")}</p>
          {facts.status === "ready" ? (
            <p className="font-medium text-foreground">
              {t("help.checklist.progress", {
                done: doneCount(facts.data, preferences),
                total: CHECKLIST_STEPS.length,
              })}
            </p>
          ) : null}
        </div>
        {facts.status === "ready" ? null : (
          <ResourceFallback t={t} state={facts} onRetry={onRetry} />
        )}
        <ol className="flex list-decimal flex-col gap-4 ps-6">
          {CHECKLIST_STEPS.map((step) => {
            const manual = step.mode === "manual";
            const ticked = manual && preferences.manualDone.includes(step.id as ManualStepId);
            const state: FactState | null = manual
              ? ticked
                ? "done"
                : "todo"
              : facts.status === "ready"
                ? facts.data[step.id as ComputedStepId]
                : null;
            const checkboxId = `checklist-${place}-${step.id}`;
            return (
              <li key={step.id} className="text-foreground">
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {t(`help.checklist.step.${step.id}.title`)}
                    </span>
                    {state === null ? null : (
                      <StatusBadge tone={TONE[state]} label={t(`help.checklist.status.${state}`)} />
                    )}
                  </p>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {t(`help.checklist.step.${step.id}.text`)}
                  </p>
                  {manual ? (
                    <div className="flex flex-col gap-1">
                      <Checkbox
                        id={checkboxId}
                        label={t("help.checklist.manualLabel")}
                        checked={ticked}
                        onChange={(event) =>
                          onToggleManual(step.id as ManualStepId, event.currentTarget.checked)
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        {t("help.checklist.manualHint")}
                      </p>
                    </div>
                  ) : null}
                  <p className="flex flex-wrap gap-x-4 gap-y-1">
                    <Link
                      to={helpArticlePath(step.article, step.section)}
                      className={standaloneLinkClass}
                    >
                      {t("help.checklist.readArticle")}
                    </Link>
                    {step.screen !== "home" && canOpen(step.screen) ? (
                      <Link to={PATHS[step.screen]} className={standaloneLinkClass}>
                        {t("help.checklist.openScreen")}
                      </Link>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-2">
          {place === "help" && preferences.dismissed ? (
            <p className="text-muted-foreground">{t("help.checklist.hiddenOnHome")}</p>
          ) : null}
          <div>
            {place === "home" ? (
              <Button variant="secondary" onClick={() => onToggleShownOnHome(false)}>
                {t("help.checklist.dismiss")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => onToggleShownOnHome(preferences.dismissed)}
              >
                {t(preferences.dismissed ? "help.checklist.restore" : "help.checklist.dismiss")}
              </Button>
            )}
          </div>
          {storageFailed ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("help.checklist.storageFailed")}
            </p>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

/** What the start page shows right after the card was hidden there (focused, so the keyboard focus is not lost). */
export function HiddenNoticeView({
  t,
  headingRef,
}: {
  t: Translator;
  headingRef: RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <p ref={headingRef} tabIndex={-1} role="status" className="text-muted-foreground">
      {t("help.checklist.hiddenNotice")}{" "}
      <Link to={PATHS.help} className={inlineLinkClass}>
        {t("help.checklist.openHelp")}
      </Link>
    </p>
  );
}
