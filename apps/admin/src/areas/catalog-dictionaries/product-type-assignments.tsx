import type {
  AdminOption,
  AdminProductTypeAttribute,
  AdminProductTypeOptionAssignment,
  ProductTypeAttributeLevel,
} from "@fluxkit/api-client";
import {
  Button,
  Checkbox,
  DataTable,
  Field,
  Select,
  StatusBadge,
  type Translator,
} from "@fluxkit/ui";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { adminClient } from "../../lib/api";
import { PATHS, buildPath } from "../../router/paths";
import {
  attributeAssignmentBody,
  optionAssignmentBody,
  validateAttributeAssignment,
  validateOptionAssignment,
  type AttributeAssignmentValues,
  type OptionAssignmentValues,
} from "./dictionary-forms";
import { linkClass, type NoticeKind } from "./dictionary-frame";
import { ConfirmDelete, FormDialog, useDialogTarget } from "./form-dialog";
import { TextField, describe, type ContentLocales } from "./form-parts";
import { hasIssues } from "./form-rules";
import { resolveLocalized } from "./locale-text";
import { ServerPicker } from "./server-picker";
import { useFormSubmit } from "./use-form-submit";

const LEVELS: readonly ProductTypeAttributeLevel[] = ["product", "variant"];

interface AssignmentSectionProps {
  t: Translator;
  content: ContentLocales;
  uiLocale: string;
  productTypeId: string;
  /** Without it there is no assign, change or remove control. */
  canWrite: boolean;
  onChanged: (kind: NoticeKind) => void;
}

// ------------------------------------------------------------ attribute assignments

type AttributeTarget = { mode: "add" } | { mode: "edit"; row: AdminProductTypeAttribute };

function AttributeAssignmentDialog({
  t,
  content,
  uiLocale,
  productTypeId,
  assigned,
  target,
  onClose,
  onChanged,
}: Omit<AssignmentSectionProps, "canWrite"> & {
  assigned: ReadonlySet<string>;
  target: AttributeTarget;
  onClose: () => void;
}) {
  const formId = useId();
  const edit = target.mode === "edit";
  const [values, setValues] = useState<AttributeAssignmentValues>(
    target.mode === "edit"
      ? {
          attributeId: target.row.attributeId,
          level: target.row.level,
          isRequired: target.row.isRequired,
          position: String(target.row.position),
        }
      : { attributeId: "", level: "product", isRequired: false, position: "" },
  );
  const form = useFormSubmit(["attributeId", "level", "isRequired", "position"]);
  const issues = form.state.fieldErrors;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const local = validateAttributeAssignment(values, edit ? "edit" : "add");
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.putProductTypeAttribute(
        productTypeId,
        values.attributeId,
        attributeAssignmentBody(values),
      ),
    );
    if (outcome.kind === "ok") {
      onClose();
      onChanged("assignmentSaved");
    } else if (outcome.kind === "unknown") {
      onClose();
      onChanged("unknown");
    }
  }

  return (
    <FormDialog
      t={t}
      title={t(edit ? "dict.assignment.attribute.editTitle" : "dict.assignment.attribute.addTitle")}
      formId={formId}
      busy={form.state.busy}
      submitLabel={t("dict.form.save")}
      busyLabel={t("dict.form.saving")}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      summary={form.state.summary}
      summaryRef={form.summaryRef}
    >
      {target.mode === "edit" ? (
        <TextField
          t={t}
          id={`${formId}-attribute`}
          name="attributeCode"
          label={t("dict.assignment.attribute.attribute")}
          value={target.row.attributeCode}
          readOnly
          onChange={() => undefined}
        />
      ) : (
        <ServerPicker
          t={t}
          id={`${formId}-attributeId`}
          name="attributeId"
          label={t("dict.assignment.attribute.attribute")}
          value={values.attributeId}
          required
          error={issues["attributeId"]}
          onChange={(attributeId) => setValues((current) => ({ ...current, attributeId }))}
          fetchPage={(offset, limit, signal) =>
            adminClient.listAttributes({ offset, limit, signal })
          }
          keyOf={(attribute) => attribute.id}
          labelOf={(attribute) =>
            `${attribute.code} - ${resolveLocalized(attribute.name, uiLocale, content.defaultLocale)}`
          }
          disabledReason={(attribute) =>
            assigned.has(attribute.id) ? t("dict.assignment.alreadyAssigned") : null
          }
        />
      )}
      <Field
        id={`${formId}-level`}
        label={t("dict.assignment.attribute.level")}
        hint={t("dict.assignment.attribute.levelHint")}
        error={issues["level"] === undefined ? undefined : describe(t, issues["level"])}
        required
        requiredIndicator={t("dict.form.requiredMark")}
      >
        {(control) => (
          <Select
            {...control}
            name="level"
            value={values.level}
            onChange={(event) => {
              const level = LEVELS.find((candidate) => candidate === event.target.value);
              if (level !== undefined) setValues((current) => ({ ...current, level }));
            }}
          >
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`dict.level.${level}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        id={`${formId}-isRequired`}
        name="isRequired"
        label={t("dict.assignment.attribute.isRequired")}
        checked={values.isRequired}
        onChange={(event) =>
          setValues((current) => ({ ...current, isRequired: event.target.checked }))
        }
      />
      <TextField
        t={t}
        id={`${formId}-position`}
        name="position"
        label={t("dict.assignment.position")}
        hint={t("dict.assignment.positionHint")}
        value={values.position}
        inputMode="numeric"
        error={issues["position"]}
        onChange={(position) => setValues((current) => ({ ...current, position }))}
      />
    </FormDialog>
  );
}

/** The attributes a product type has: level (product or variant), required, position. Reads only without write permission. */
export function AttributeAssignmentsSection({
  rows,
  ...props
}: AssignmentSectionProps & { rows: readonly AdminProductTypeAttribute[] }) {
  const { t, content, uiLocale, productTypeId, canWrite, onChanged } = props;
  const dialog = useDialogTarget<AttributeTarget>();
  const removing = useDialogTarget<AdminProductTypeAttribute>();
  const toRemove = removing.target;
  const headingId = useId();
  const assigned = new Set(rows.map((row) => row.attributeId));
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {t("dict.assignment.attribute.heading")}
        </h2>
        {canWrite ? (
          <Button variant="secondary" onClick={() => dialog.open({ mode: "add" })}>
            {t("dict.assignment.attribute.add")}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t("dict.assignment.attribute.caption")}
        captionHidden
        columns={[
          {
            id: "attribute",
            header: t("dict.assignment.attribute.attribute"),
            cell: (row) => (
              <span className="flex flex-col">
                <Link
                  to={buildPath(PATHS.attributeDetail, { id: row.attributeId })}
                  className={linkClass}
                >
                  {row.attributeCode}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {resolveLocalized(row.attribute.name, uiLocale, content.defaultLocale)}
                </span>
              </span>
            ),
          },
          {
            id: "level",
            header: t("dict.assignment.attribute.level"),
            cell: (row) => t(`dict.level.${row.level}`),
          },
          {
            id: "required",
            header: t("dict.assignment.attribute.isRequired"),
            cell: (row) => (
              <StatusBadge
                tone={row.isRequired ? "warning" : "neutral"}
                label={t(row.isRequired ? "dict.form.yes" : "dict.form.no")}
              />
            ),
          },
          {
            id: "position",
            header: t("dict.assignment.position"),
            align: "end",
            cell: (row) => row.position,
          },
        ]}
        rows={rows}
        rowKey={(row) => row.attributeId}
        emptyMessage={t("dict.assignment.attribute.empty")}
        actions={
          canWrite
            ? {
                header: t("dict.assignment.actions"),
                render: (row) => (
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t("dict.assignment.attribute.editLabel", {
                        code: row.attributeCode,
                      })}
                      onClick={() => dialog.open({ mode: "edit", row })}
                    >
                      {t("dict.form.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t("dict.assignment.attribute.removeLabel", {
                        code: row.attributeCode,
                      })}
                      onClick={() => removing.open(row)}
                    >
                      {t("dict.assignment.remove")}
                    </Button>
                  </span>
                ),
              }
            : undefined
        }
      />
      {canWrite && dialog.target !== null ? (
        <AttributeAssignmentDialog
          key={dialog.key}
          t={t}
          content={content}
          uiLocale={uiLocale}
          productTypeId={productTypeId}
          assigned={assigned}
          target={dialog.target}
          onClose={dialog.close}
          onChanged={onChanged}
        />
      ) : null}
      {canWrite && toRemove !== null ? (
        <ConfirmDelete
          key={removing.key}
          t={t}
          canWrite={canWrite}
          open
          onClose={removing.close}
          remove={() => adminClient.removeProductTypeAttribute(productTypeId, toRemove.attributeId)}
          onDeleted={() => {
            removing.close();
            onChanged("assignmentRemoved");
          }}
          onUnknown={() => {
            removing.close();
            onChanged("unknown");
          }}
          title={t("dict.assignment.attribute.removeTitle", { code: toRemove.attributeCode })}
          description={t("dict.assignment.attribute.removeBody")}
          hint={t("dict.assignment.attribute.removeHint")}
          confirmLabel={t("dict.assignment.remove")}
        />
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------- option assignments

type OptionTarget = { mode: "add" } | { mode: "edit"; row: AdminProductTypeOptionAssignment };

function OptionAssignmentDialog({
  t,
  content,
  uiLocale,
  productTypeId,
  assigned,
  target,
  onClose,
  onChanged,
}: Omit<AssignmentSectionProps, "canWrite"> & {
  assigned: ReadonlySet<string>;
  target: OptionTarget;
  onClose: () => void;
}) {
  const formId = useId();
  const edit = target.mode === "edit";
  const [values, setValues] = useState<OptionAssignmentValues>(
    target.mode === "edit"
      ? { optionId: target.row.optionId, position: String(target.row.position) }
      : { optionId: "", position: "" },
  );
  const form = useFormSubmit(["optionId", "position"]);
  const issues = form.state.fieldErrors;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy) return;
    const local = validateOptionAssignment(values, edit ? "edit" : "add");
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.putProductTypeOption(
        productTypeId,
        values.optionId,
        optionAssignmentBody(values),
      ),
    );
    if (outcome.kind === "ok") {
      onClose();
      onChanged("assignmentSaved");
    } else if (outcome.kind === "unknown") {
      onClose();
      onChanged("unknown");
    }
  }

  return (
    <FormDialog
      t={t}
      title={t(edit ? "dict.assignment.option.editTitle" : "dict.assignment.option.addTitle")}
      formId={formId}
      busy={form.state.busy}
      submitLabel={t("dict.form.save")}
      busyLabel={t("dict.form.saving")}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      summary={form.state.summary}
      summaryRef={form.summaryRef}
    >
      {target.mode === "edit" ? (
        <TextField
          t={t}
          id={`${formId}-option`}
          name="optionCode"
          label={t("dict.assignment.option.option")}
          value={target.row.optionCode}
          readOnly
          onChange={() => undefined}
        />
      ) : (
        <ServerPicker<AdminOption>
          t={t}
          id={`${formId}-optionId`}
          name="optionId"
          label={t("dict.assignment.option.option")}
          value={values.optionId}
          required
          error={issues["optionId"]}
          onChange={(optionId) => setValues((current) => ({ ...current, optionId }))}
          fetchPage={(offset, limit, signal) => adminClient.listOptions({ offset, limit, signal })}
          keyOf={(option) => option.id}
          labelOf={(option) =>
            `${option.code} - ${resolveLocalized(option.name, uiLocale, content.defaultLocale)}`
          }
          disabledReason={(option) =>
            assigned.has(option.id) ? t("dict.assignment.alreadyAssigned") : null
          }
        />
      )}
      <TextField
        t={t}
        id={`${formId}-position`}
        name="position"
        label={t("dict.assignment.position")}
        hint={t("dict.assignment.positionHint")}
        value={values.position}
        inputMode="numeric"
        error={issues["position"]}
        onChange={(position) => setValues((current) => ({ ...current, position }))}
      />
    </FormDialog>
  );
}

/** The options (variant axes) a product type allows, with their position. Reads only without write permission. */
export function OptionAssignmentsSection({
  rows,
  ...props
}: AssignmentSectionProps & { rows: readonly AdminProductTypeOptionAssignment[] }) {
  const { t, content, uiLocale, productTypeId, canWrite, onChanged } = props;
  const dialog = useDialogTarget<OptionTarget>();
  const removing = useDialogTarget<AdminProductTypeOptionAssignment>();
  const toRemove = removing.target;
  const headingId = useId();
  const assigned = new Set(rows.map((row) => row.optionId));
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {t("dict.assignment.option.heading")}
        </h2>
        {canWrite ? (
          <Button variant="secondary" onClick={() => dialog.open({ mode: "add" })}>
            {t("dict.assignment.option.add")}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t("dict.assignment.option.caption")}
        captionHidden
        columns={[
          {
            id: "option",
            header: t("dict.assignment.option.option"),
            cell: (row) => (
              <Link to={buildPath(PATHS.optionDetail, { id: row.optionId })} className={linkClass}>
                {row.optionCode}
              </Link>
            ),
          },
          {
            id: "position",
            header: t("dict.assignment.position"),
            align: "end",
            cell: (row) => row.position,
          },
        ]}
        rows={rows}
        rowKey={(row) => row.optionId}
        emptyMessage={t("dict.assignment.option.empty")}
        actions={
          canWrite
            ? {
                header: t("dict.assignment.actions"),
                render: (row) => (
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      aria-label={t("dict.assignment.option.editLabel", { code: row.optionCode })}
                      onClick={() => dialog.open({ mode: "edit", row })}
                    >
                      {t("dict.form.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t("dict.assignment.option.removeLabel", { code: row.optionCode })}
                      onClick={() => removing.open(row)}
                    >
                      {t("dict.assignment.remove")}
                    </Button>
                  </span>
                ),
              }
            : undefined
        }
      />
      {canWrite && dialog.target !== null ? (
        <OptionAssignmentDialog
          key={dialog.key}
          t={t}
          content={content}
          uiLocale={uiLocale}
          productTypeId={productTypeId}
          assigned={assigned}
          target={dialog.target}
          onClose={dialog.close}
          onChanged={onChanged}
        />
      ) : null}
      {canWrite && toRemove !== null ? (
        <ConfirmDelete
          key={removing.key}
          t={t}
          canWrite={canWrite}
          open
          onClose={removing.close}
          remove={() => adminClient.removeProductTypeOption(productTypeId, toRemove.optionId)}
          onDeleted={() => {
            removing.close();
            onChanged("assignmentRemoved");
          }}
          onUnknown={() => {
            removing.close();
            onChanged("unknown");
          }}
          title={t("dict.assignment.option.removeTitle", { code: toRemove.optionCode })}
          description={t("dict.assignment.option.removeBody")}
          hint={t("dict.assignment.option.removeHint")}
          confirmLabel={t("dict.assignment.remove")}
        />
      ) : null}
    </section>
  );
}
