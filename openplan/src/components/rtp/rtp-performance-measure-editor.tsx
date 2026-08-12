"use client";

/**
 * PERFORMANCE MEASURES FOR AN RTP CYCLE.
 *
 * A performance measure is the plan saying, in numbers, what it is trying to
 * change and how anyone will later know whether it happened: where the region
 * stands today (the baseline), where it intends to be (the target), the years
 * each of those describes, and where the numbers came from.
 *
 * Two rendering rules here are load-bearing, not decoration.
 *
 * 1. **A baseline of 0 is a measurement, not an absence.** Zero pedestrian
 *    fatalities, zero miles of bridge in poor condition, zero unfunded
 *    projects — these are the results an agency most wants to state, and a
 *    truthiness check (`value ? … : "not measured"`) erases exactly them. Every
 *    presence test in this file compares against `null`, never against
 *    falsiness, and `toFiniteNumber` is the single place that decides.
 *
 * 2. **A missing data source is said out loud.** The column exists because a
 *    measure with no stated source is an assertion rather than evidence; a
 *    blank space on the row would let it pass for one. So the row says which it
 *    is, in a planner's words, either way.
 *
 * The measure key is deliberately free text (see the migration's own comment):
 * the federal PM1/PM2/PM3 set is US-specific and has been changed by rulemaking
 * more than once, so nothing here freezes a vocabulary. An agency names its own
 * measures; a registry can offer known ones later without a schema change.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Gauge, Loader2, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtractionProvenanceChip } from "@/components/rtp/extraction-provenance-chip";
import {
  transcriptionDocumentHref,
  type TranscriptionRecord,
} from "@/lib/rtp/extraction/display";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * `NUMERIC(18,4)` reaches a page as a JSON number, but a loader that hands the
 * raw column through can also hand through the string form — and `"0"` failing
 * a `typeof value === "number"` test is precisely how a real zero turns into
 * "not measured". Accepting both spellings costs one branch and removes the
 * failure mode entirely.
 */
type MeasureNumber = number | string | null;

export type RtpPerformanceMeasureRow = {
  id: string;
  measureKey: string;
  label: string;
  unit: string | null;
  baselineValue: MeasureNumber;
  baselineYear: number | null;
  targetValue: MeasureNumber;
  targetYear: number | null;
  dataSource: string | null;
  notes: string | null;
  sortOrder: number;
};

export type RtpPerformanceMeasureEditorProps = {
  rtpCycleId: string;
  measures: ReadonlyArray<RtpPerformanceMeasureRow>;
  canWrite: boolean;
  /**
   * Which of these measures were copied out of a document, keyed by measure id,
   * so a transcribed baseline cites the page it was read off (Nathaniel's Q2
   * decision, 2026-08-11).
   *
   * A measure that is not in here was typed by a person and shows no chip —
   * permanently, with no backfill. A baseline is a measurement of the world,
   * and where that measurement came from is exactly the thing a reader of a
   * performance measure most needs.
   */
  transcriptions?: Readonly<Record<string, TranscriptionRecord>>;
};

/** House convention for planner-facing numbers: a fixed locale, so a server render and a client render agree. */
const MEASURE_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/** The one place presence is decided. `0` and `"0"` are present; `null`, `""` and `"abc"` are not. */
function toFiniteNumber(value: MeasureNumber | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Returns `null` only when there is no number to show — never for a zero. */
function formatMeasureValue(value: MeasureNumber | undefined, unit: string | null): string | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  const formatted = MEASURE_NUMBER_FORMATTER.format(numeric);
  const trimmedUnit = unit?.trim();
  return trimmedUnit ? `${formatted} ${trimmedUnit}` : formatted;
}

/** A stored number back into a text input, without `NUMERIC(18,4)`'s trailing zeros. */
function numberToInput(value: MeasureNumber | number | undefined): string {
  const numeric = toFiniteNumber(value ?? null);
  return numeric === null ? "" : String(numeric);
}

type MeasureDraft = {
  measureKey: string;
  label: string;
  unit: string;
  baselineValue: string;
  baselineYear: string;
  targetValue: string;
  targetYear: string;
  dataSource: string;
  notes: string;
  sortOrder: string;
};

function emptyDraft(nextSortOrder: number): MeasureDraft {
  return {
    measureKey: "",
    label: "",
    unit: "",
    baselineValue: "",
    baselineYear: "",
    targetValue: "",
    targetYear: "",
    dataSource: "",
    notes: "",
    sortOrder: String(nextSortOrder),
  };
}

function draftFromMeasure(measure: RtpPerformanceMeasureRow): MeasureDraft {
  return {
    measureKey: measure.measureKey,
    label: measure.label,
    unit: measure.unit ?? "",
    baselineValue: numberToInput(measure.baselineValue),
    baselineYear: numberToInput(measure.baselineYear),
    targetValue: numberToInput(measure.targetValue),
    targetYear: numberToInput(measure.targetYear),
    dataSource: measure.dataSource ?? "",
    notes: measure.notes ?? "",
    sortOrder: numberToInput(measure.sortOrder) || "0",
  };
}

/**
 * Text limits mirrored from the route's zod schema
 * (`src/app/api/rtp-cycles/[rtpCycleId]/performance-measures/route.ts`), which
 * is the authority — the TEXT columns themselves are uncapped.
 *
 * They are repeated here for one reason: the route answers a too-long field
 * with "Invalid performance measure payload" and names no field, which a
 * planner who has just pasted a long citation cannot act on. Checking here lets
 * the refusal say which box and what to do. The limits are also NOT enforced
 * with `maxLength` on the inputs, because that truncates a paste silently — and
 * a citation quietly cut at 300 characters is worse than being asked to shorten
 * it.
 */
const FIELD_LIMITS = {
  measureKey: 120,
  label: 200,
  unit: 60,
  dataSource: 300,
  notes: 2000,
} as const;

/**
 * `baseline_value` / `target_value` are `NUMERIC(18, 4)` — fourteen digits ahead
 * of the decimal point — and `sort_order` is bounded by the route. Both bounds
 * are mirrored for the same reason as the text limits above: past them the route
 * answers "Invalid performance measure payload", and a planner who pasted a
 * figure in dollars rather than thousands cannot act on that sentence.
 *
 * NEGATIVE VALUES ARE ALLOWED ON PURPOSE, on both sides of zero. A measure is
 * often a change rather than a level — "net change in VMT per capita: -3.2" —
 * and clamping to positive here would refuse a legitimate baseline the column,
 * the route and the plan all accept.
 */
const MEASURE_VALUE_LIMIT = 99_999_999_999_999;
const SORT_ORDER_LIMIT = 100_000;

type ParsedField = { ok: true; value: number | null } | { ok: false; message: string };

function parseOptionalDecimal(raw: string, fieldLabel: string, limit: number): ParsedField {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `${fieldLabel} must be a number, or left empty.` };
  }
  if (Math.abs(parsed) > limit) {
    const bound = MEASURE_NUMBER_FORMATTER.format(limit);
    return { ok: false, message: `${fieldLabel} must be between -${bound} and ${bound}.` };
  }
  return { ok: true, value: parsed };
}

/** Mirrors the table's own CHECK (1900–2200) so a typo reads as a sentence rather than a 400. */
function parseOptionalYear(raw: string, fieldLabel: string): ParsedField {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200) {
    return { ok: false, message: `${fieldLabel} must be a whole year between 1900 and 2200, or left empty.` };
  }
  return { ok: true, value: parsed };
}

/** Returns a sentence naming the box that is too long, or `null` when every field fits. */
function checkLengths(values: {
  measureKey: string;
  label: string;
  unit: string;
  dataSource: string;
  notes: string;
}): string | null {
  const checks: Array<{ value: string; limit: number; field: string; advice: string }> = [
    { value: values.measureKey, limit: FIELD_LIMITS.measureKey, field: "measure key", advice: "Keys are meant to be short and stable." },
    { value: values.label, limit: FIELD_LIMITS.label, field: "measure name", advice: "Move the detail into Notes." },
    { value: values.unit, limit: FIELD_LIMITS.unit, field: "unit", advice: "A unit is a few words — put the method in Notes." },
    { value: values.dataSource, limit: FIELD_LIMITS.dataSource, field: "data source", advice: "Name the dataset and its vintage here, and put the rest in Notes." },
    { value: values.notes, limit: FIELD_LIMITS.notes, field: "notes", advice: "Trim it, or keep the long version in the chapter draft." },
  ];

  for (const check of checks) {
    if (check.value.length > check.limit) {
      return `The ${check.field} is ${check.value.length} characters; this field holds ${check.limit}. ${check.advice}`;
    }
  }
  return null;
}

type BuiltPayload =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

function buildMeasurePayload(
  draft: MeasureDraft,
  existing: ReadonlyArray<RtpPerformanceMeasureRow>,
  editingId: string | null
): BuiltPayload {
  const measureKey = draft.measureKey.trim();
  const label = draft.label.trim();

  if (!measureKey) return { ok: false, message: "Give this measure a key so exports and reports can address it." };
  if (!label) return { ok: false, message: "Give this measure a name a reader will understand." };

  const tooLong = checkLengths({ measureKey, label, unit: draft.unit.trim(), dataSource: draft.dataSource.trim(), notes: draft.notes.trim() });
  if (tooLong) return { ok: false, message: tooLong };

  // Compared EXACTLY, because the table's UNIQUE(rtp_cycle_id, measure_key) is
  // exact. A case-insensitive check here would refuse a key the database would
  // have accepted, and a screen that invents a constraint the system does not
  // have is its own kind of wrong answer.
  const duplicate = existing.some((measure) => measure.id !== editingId && measure.measureKey.trim() === measureKey);
  if (duplicate) {
    return {
      ok: false,
      message: `This plan already has a measure with the key “${measureKey}”. Keys are unique within a plan so the same measure can be tracked across updates.`,
    };
  }

  const baselineValue = parseOptionalDecimal(draft.baselineValue, "The baseline value", MEASURE_VALUE_LIMIT);
  if (!baselineValue.ok) return baselineValue;
  const baselineYear = parseOptionalYear(draft.baselineYear, "The baseline year");
  if (!baselineYear.ok) return baselineYear;
  const targetValue = parseOptionalDecimal(draft.targetValue, "The target value", MEASURE_VALUE_LIMIT);
  if (!targetValue.ok) return targetValue;
  const targetYear = parseOptionalYear(draft.targetYear, "The target year");
  if (!targetYear.ok) return targetYear;

  const sortOrder = parseOptionalDecimal(draft.sortOrder, "The display order", SORT_ORDER_LIMIT);
  if (!sortOrder.ok) return sortOrder;
  // A BLANK DISPLAY ORDER IS REFUSED RATHER THAN READ AS 0, which is the same
  // rule the route states for `sort_order` — "a blank box there is a caller
  // mistake, not an 'unset', and accepting it would mean writing a value the
  // planner did not choose." Sending 0 for an emptied box would silently move
  // an edited measure to the top of the plan's list; the box is pre-filled on
  // both paths, so a blank one is always something that was cleared on purpose.
  if (sortOrder.value === null) {
    return {
      ok: false,
      message: "Give this measure a display order — the position it should hold in the list, such as 0 for first.",
    };
  }
  if (!Number.isInteger(sortOrder.value)) {
    return { ok: false, message: "The display order must be a whole number." };
  }

  return {
    ok: true,
    body: {
      measureKey,
      label,
      // An emptied optional field means "clear this", so it is sent as null
      // rather than omitted — an omitted field is how a correction silently
      // does nothing.
      unit: draft.unit.trim() || null,
      baselineValue: baselineValue.value,
      baselineYear: baselineYear.value,
      targetValue: targetValue.value,
      targetYear: targetYear.value,
      dataSource: draft.dataSource.trim() || null,
      notes: draft.notes.trim() || null,
      sortOrder: sortOrder.value,
    },
  };
}

/**
 * Direction of travel, stated without judgment. Fewer fatalities is better and
 * less pavement in good condition is worse, and this component has no way to
 * know which measure it is looking at — so it reports "above"/"below" and lets
 * the planner's own goal supply the meaning. Percent change is deliberately not
 * offered: it is undefined against a baseline of zero, which is a value this
 * table is expected to hold.
 */
function describeDirection(measure: RtpPerformanceMeasureRow): string | null {
  const baseline = toFiniteNumber(measure.baselineValue);
  const target = toFiniteNumber(measure.targetValue);
  if (baseline === null || target === null) return null;

  const delta = target - baseline;
  if (delta === 0) return "The target holds the baseline steady.";

  const unit = measure.unit?.trim();
  const magnitude = MEASURE_NUMBER_FORMATTER.format(Math.abs(delta));
  const amount = unit ? `${magnitude} ${unit}` : magnitude;
  return `The target is ${amount} ${delta > 0 ? "above" : "below"} the baseline.`;
}

function MeasurePoint({
  caption,
  valueText,
  year,
  emptyText,
}: {
  caption: string;
  valueText: string | null;
  year: number | null;
  emptyText: string;
}) {
  return (
    <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{caption}</p>
      {valueText === null ? (
        <>
          <p className="text-sm text-muted-foreground">{emptyText}</p>
          {year !== null ? <p className="text-[0.72rem] text-muted-foreground">Year recorded: {year}</p> : null}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-foreground">{valueText}</p>
          <p className="text-[0.72rem] text-muted-foreground">{year !== null ? year : "Year not recorded"}</p>
        </>
      )}
    </div>
  );
}

/**
 * `role="alert"` because most refusals here are raised by the client itself,
 * after a keyboard user pressed Save — with focus still in the form, an
 * unannounced banner is a refusal they never hear.
 */
function MeasureErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
    >
      {message}
    </p>
  );
}

function MeasureFields({
  idPrefix,
  draft,
  onChange,
  disabled,
}: {
  idPrefix: string;
  draft: MeasureDraft;
  onChange: (patch: Partial<MeasureDraft>) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-label`} className="text-[0.82rem] font-semibold">
          Measure name
        </label>
        <Input
          id={`${idPrefix}-label`}
          value={draft.label}
          onChange={(event) => onChange({ label: event.target.value })}
          disabled={disabled}
          placeholder="What this measure is called in the plan"
          required
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-key`} className="text-[0.82rem] font-semibold">
            Measure key
          </label>
          <Input
            id={`${idPrefix}-key`}
            value={draft.measureKey}
            onChange={(event) => onChange({ measureKey: event.target.value })}
            disabled={disabled}
            placeholder="fatalities-per-100m-vmt"
            required
          />
          <p className="text-[0.72rem] text-muted-foreground">
            A short, stable id for this measure. Reports and exports address it by this key, so keep it the same
            across plan updates. It must be unique within this plan.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-unit`} className="text-[0.82rem] font-semibold">
            Unit
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Input
            id={`${idPrefix}-unit`}
            value={draft.unit}
            onChange={(event) => onChange({ unit: event.target.value })}
            disabled={disabled}
            placeholder="percent of lane miles in good condition"
          />
          <p className="text-[0.72rem] text-muted-foreground">
            Without a unit, a baseline and a target are two bare numbers.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-baseline-value`} className="text-[0.82rem] font-semibold">
            Baseline value
          </label>
          <Input
            id={`${idPrefix}-baseline-value`}
            type="number"
            step="any"
            value={draft.baselineValue}
            onChange={(event) => onChange({ baselineValue: event.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-baseline-year`} className="text-[0.82rem] font-semibold">
            Baseline year
          </label>
          <Input
            id={`${idPrefix}-baseline-year`}
            type="number"
            step="1"
            value={draft.baselineYear}
            onChange={(event) => onChange({ baselineYear: event.target.value })}
            disabled={disabled}
            placeholder="The year the baseline describes"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-target-value`} className="text-[0.82rem] font-semibold">
            Target value
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Input
            id={`${idPrefix}-target-value`}
            type="number"
            step="any"
            value={draft.targetValue}
            onChange={(event) => onChange({ targetValue: event.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-target-year`} className="text-[0.82rem] font-semibold">
            Target year
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Input
            id={`${idPrefix}-target-year`}
            type="number"
            step="1"
            value={draft.targetYear}
            onChange={(event) => onChange({ targetYear: event.target.value })}
            disabled={disabled}
            placeholder="The year the target is meant to be reached"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-data-source`} className="text-[0.82rem] font-semibold">
          Data source
        </label>
        <Input
          id={`${idPrefix}-data-source`}
          value={draft.dataSource}
          onChange={(event) => onChange({ dataSource: event.target.value })}
          disabled={disabled}
          placeholder="Where these numbers come from, and which year of it"
        />
        <p className="text-[0.72rem] text-muted-foreground">
          This is what makes the measure evidence instead of an assertion. Name the dataset, the agency that
          publishes it, and the vintage you read.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-notes`} className="text-[0.82rem] font-semibold">
          Notes
          <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
        </label>
        <Textarea
          id={`${idPrefix}-notes`}
          rows={3}
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          disabled={disabled}
          placeholder="Method, caveats, or what would have to change for the target to be met."
        />
      </div>

      <div className="space-y-1.5 md:max-w-[12rem]">
        <label htmlFor={`${idPrefix}-sort-order`} className="text-[0.82rem] font-semibold">
          Display order
        </label>
        <Input
          id={`${idPrefix}-sort-order`}
          type="number"
          step="1"
          value={draft.sortOrder}
          onChange={(event) => onChange({ sortOrder: event.target.value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function RtpPerformanceMeasureEditor({
  rtpCycleId,
  measures,
  canWrite,
  transcriptions,
}: RtpPerformanceMeasureEditorProps) {
  const router = useRouter();
  // `"create"` for the new-measure form, a measure id while editing that row, `null` when closed.
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeasureDraft>(() => emptyDraft(0));
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orderedMeasures = useMemo(() => {
    return [...measures].sort((left, right) => {
      const leftOrder = toFiniteNumber(left.sortOrder) ?? 0;
      const rightOrder = toFiniteNumber(right.sortOrder) ?? 0;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.label.localeCompare(right.label);
    });
  }, [measures]);

  const nextSortOrder = useMemo(() => {
    if (measures.length === 0) return 0;
    return measures.reduce((highest, measure) => Math.max(highest, toFiniteNumber(measure.sortOrder) ?? 0), 0) + 1;
  }, [measures]);

  function openCreateForm() {
    setError(null);
    setDraft(emptyDraft(nextSortOrder));
    setOpenForm("create");
  }

  function openEditForm(measure: RtpPerformanceMeasureRow) {
    setError(null);
    setDraft(draftFromMeasure(measure));
    setOpenForm(measure.id);
  }

  function closeForm() {
    setError(null);
    setOpenForm(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const editingId = openForm && openForm !== "create" ? openForm : null;
    const built = buildMeasurePayload(draft, measures, editingId);
    if (!built.ok) {
      setError(built.message);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/performance-measures`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingId ? { measureId: editingId, ...built.body } : built.body),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save this performance measure");
      }

      setOpenForm(null);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save this performance measure");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(measure: RtpPerformanceMeasureRow) {
    const confirmed = window.confirm(
      `Remove the performance measure “${measure.label}” from this plan? Its baseline, target, and data source are deleted with it.`
    );
    if (!confirmed) return;

    setError(null);
    setRemovingId(measure.id);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/performance-measures`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ measureId: measure.id }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to remove this performance measure");
      }

      if (openForm === measure.id) setOpenForm(null);
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove this performance measure");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Performance element</p>
          <h2 className="module-section-title">Performance measures</h2>
          <p className="module-section-description">
            What this plan is trying to change, stated as numbers: where the region stands now, where it intends to
            be, and where those numbers come from.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Gauge className="h-5 w-5" />
        </span>
      </div>

      {/*
        THE REFUSAL IS SHOWN WHERE THE PLANNER IS LOOKING, which is why this
        renders here only while no form is open. Most refusals here are raised
        by this component itself, the instant Save is pressed — and a plan with
        a dozen measures puts the form a long way below this heading, so a
        banner pinned to the top is a refusal a sighted planner never sees: the
        button appears to do nothing at all. When a form is open the same banner
        is rendered inside it, next to the button that was just pressed.
        Exactly one is on the page at a time, so a screen reader announces the
        refusal once.
      */}
      {error && openForm === null ? <MeasureErrorBanner message={error} /> : null}

      <div className="mt-5 space-y-4">
        {orderedMeasures.length === 0 ? (
          <div className="module-empty-state space-y-2 text-sm">
            <p>No performance measures recorded for this plan yet.</p>
            <p>
              A performance measure is how the plan says what it is trying to change and how anyone will know
              whether it happened: the number today, the number the region is aiming for, the year each of those
              describes, and where the numbers come from. Safety, pavement and bridge condition, transit ridership,
              travel time reliability — whichever this region&apos;s goals are actually measured by.
            </p>
            {canWrite ? (
              <p>Add the handful a board or a funder will ask about, and the plan can be checked against them later.</p>
            ) : null}
          </div>
        ) : (
          <div className="module-record-list">
            {orderedMeasures.map((measure) => {
              const unit = measure.unit?.trim() || null;
              const baselineText = formatMeasureValue(measure.baselineValue, unit);
              const targetText = formatMeasureValue(measure.targetValue, unit);
              const direction = describeDirection(measure);
              const dataSource = measure.dataSource?.trim() || null;
              const notes = measure.notes?.trim() || null;
              const isEditing = openForm === measure.id;

              return (
                <div key={measure.id} className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <span className="module-record-chip">
                          <span>Key</span>
                          <strong>{measure.measureKey}</strong>
                        </span>
                        {unit ? (
                          <span className="module-record-chip">
                            <span>Unit</span>
                            <strong>{unit}</strong>
                          </span>
                        ) : null}
                      </div>
                      <h3 className="module-record-title">{measure.label}</h3>
                      {/* The page this baseline was copied from. Nothing for a typed one. */}
                      {transcriptions?.[measure.id] ? (
                        <ExtractionProvenanceChip
                          record={transcriptions[measure.id]}
                          audience="planner"
                          documentHref={transcriptionDocumentHref(transcriptions[measure.id])}
                        />
                      ) : null}
                    </div>

                    {canWrite ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => (isEditing ? closeForm() : openEditForm(measure))}
                          disabled={isSaving || removingId === measure.id}
                          aria-expanded={isEditing}
                          aria-label={isEditing ? `Stop editing ${measure.label}` : `Edit ${measure.label}`}
                        >
                          <PencilLine />
                          {isEditing ? "Close" : "Edit"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => handleRemove(measure)}
                          disabled={removingId === measure.id || isSaving}
                          aria-label={`Remove ${measure.label}`}
                        >
                          {removingId === measure.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                    <MeasurePoint
                      caption="Baseline"
                      valueText={baselineText}
                      year={measure.baselineYear}
                      emptyText="No baseline recorded"
                    />
                    <span className="hidden justify-center text-muted-foreground sm:flex" aria-hidden="true">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                    <MeasurePoint
                      caption="Target"
                      valueText={targetText}
                      year={measure.targetYear}
                      emptyText="No target set"
                    />
                  </div>

                  {direction ? <p className="text-[0.8rem] text-muted-foreground">{direction}</p> : null}

                  {dataSource ? (
                    <p className="text-[0.8rem] text-muted-foreground">
                      <span className="font-semibold text-foreground">Data source:</span> {dataSource}
                    </p>
                  ) : (
                    <p className="text-[0.8rem] text-amber-700 dark:text-amber-300">
                      No data source recorded — until one is named, this measure is an assertion rather than
                      evidence.
                    </p>
                  )}

                  {notes ? <p className="module-record-summary">{notes}</p> : null}

                  {canWrite && isEditing ? (
                    <form className="space-y-4 rounded-[0.5rem] border border-border/70 bg-muted/20 p-4" onSubmit={handleSubmit}>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Edit performance measure
                      </p>
                      <MeasureFields
                        idPrefix={`rtp-performance-measure-${measure.id}`}
                        draft={draft}
                        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                        disabled={isSaving}
                      />
                      {error ? <MeasureErrorBanner message={error} /> : null}
                      <div className="flex items-center gap-2">
                        <Button type="submit" size="sm" disabled={isSaving}>
                          {isSaving ? <Loader2 className="animate-spin" /> : null}
                          Save measure
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={closeForm} disabled={isSaving}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {canWrite ? (
          openForm === "create" ? (
            <form className="space-y-4 rounded-[0.5rem] border border-border/70 bg-muted/20 p-4" onSubmit={handleSubmit}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Add performance measure
              </p>
              <MeasureFields
                idPrefix="rtp-performance-measure-new"
                draft={draft}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                disabled={isSaving}
              />
              {error ? <MeasureErrorBanner message={error} /> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={isSaving}>
                  {isSaving ? <Loader2 className="animate-spin" /> : null}
                  Add measure
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={closeForm} disabled={isSaving}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={openCreateForm} disabled={isSaving}>
              <Plus />
              Add performance measure
            </Button>
          )
        ) : null}
      </div>
    </article>
  );
}
