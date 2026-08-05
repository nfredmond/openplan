"use client";

/**
 * Declaring the periods an RTP programmes money across.
 *
 * A horizon band is the unit every financial figure in this plan hangs off:
 * `rtp_financial_assumptions` rows point at one (NOT NULL), programmed projects
 * are placed in one, and `computeRtpFiscalConstraint` accumulates per band —
 * which is why it answers `no_horizon_bands` and refuses to determine anything
 * when none exist. So this control is the FIRST thing a planner uses in the
 * financial element, and the empty state carries most of its weight: a planner
 * arriving at a plan with no bands has not made a mistake, they simply have not
 * been told that the periods come before the money.
 *
 * WHY THE MIDPOINT IS SHOWN RATHER THAN AN EMPTY FIELD. `escalation_target_year`
 * is nullable and null is a perfectly good answer — the engine falls back to the
 * band midpoint and discloses that it did (`expenditureYearAssumed`). But a
 * blank box gives a planner no way to know an assumption is being made on their
 * behalf, on a figure that changes every escalated dollar in the band. The form
 * therefore states the year that WILL be assumed, live, as the years are typed.
 *
 * WHY A REFUSED DELETE IS SHOWN VERBATIM. `rtp_financial_assumptions.horizon_band_id`
 * is ON DELETE RESTRICT, deliberately: removing a band that still carries revenue
 * or O&M lines would silently drop money out of the constraint check. The route's
 * 409 names how many lines are still assigned and what to do about them, so it is
 * surfaced word-for-word next to the band the planner tried to remove, rather
 * than being flattened into a generic failure.
 *
 * WHY A DELETE THAT SUCCEEDS ALSO SAYS SOMETHING. The other foreign key —
 * `project_rtp_cycle_links.horizon_band_id` — is ON DELETE SET NULL, so a
 * removal the database permits still detaches every project programmed into that
 * period, and each becomes an `unbanded_constrained_project` blocker. The route
 * counts them before deleting precisely so this can be said out loud; a plan that
 * starts reading "not determined" with no explanation is the failure being
 * avoided. A count that could not be read is reported as unknown, never as none.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Loader2, PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RtpHorizonBandInput } from "@/lib/rtp/fiscal-constraint";

/**
 * The band shape is imported, not restated. The fiscal-constraint engine and
 * this editor must agree about what a band is; sharing the type makes a drift
 * between them a compile error instead of a runtime surprise.
 */
export type RtpHorizonBandEditorProps = {
  rtpCycleId: string;
  bands: ReadonlyArray<RtpHorizonBandInput>;
  canWrite: boolean;
};

const COST_BASIS_OPTIONS: ReadonlyArray<{
  value: RtpHorizonBandInput["costEstimateBasis"];
  label: string;
  hint: string;
}> = [
  {
    value: "itemized",
    label: "Itemized — every project's cost listed separately",
    hint: "Each project programmed in this period carries its own cost estimate.",
  },
  {
    value: "banded",
    label: "Aggregate — costs grouped for the whole period",
    hint: "Costs are reported as a range or total for the period rather than project by project. Aggregate treatment is usually only accepted for later periods — check the rule your plan is adopted under.",
  },
];

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

/**
 * Mirrors the `rtp_horizon_bands` CHECK constraints and the route's own year
 * schema. These are native input hints only — the route stays the authority,
 * and the point is to spare a planner a round trip, not to enforce anything.
 */
const YEAR_MIN = 1900;
const YEAR_MAX = 2200;
const LABEL_MAX_LENGTH = 160;

/**
 * MUST MATCH `midpoint()` in `@/lib/rtp/fiscal-constraint`, which is module-private.
 * If the engine's fallback ever stops being a floored midpoint, this preview
 * becomes a confident lie about a year the planner never chose — so the two are
 * named after each other deliberately.
 */
function bandMidpoint(startYear: number, endYear: number): number {
  return Math.floor((startYear + endYear) / 2);
}

function numberToInput(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Empty string means "not stated" — never 0, which is a real year and a real amount. */
function parseOptionalYear(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Joins the server's sentences without editing any of them.
 *
 * The route's refusals do not end in a full stop (`"This period still has money
 * assigned to it"`), so a bare space would run two sentences together. The
 * separator is the only thing added — every word remains the server's.
 */
function joinRefusalParts(parts: readonly string[]): string {
  return parts.reduce((joined, part) => {
    if (!joined) return part;
    return /[.!?:;]$/.test(joined) ? `${joined} ${part}` : `${joined}. ${part}`;
  }, "");
}

/**
 * A refusal, VERBATIM, in ALL THREE of the server's own voices.
 *
 * A blocked delete answers 409 with two parts that do different jobs: `error`
 * names what happened, and `details` says how many revenue or cost lines are
 * still assigned, names them, and tells the planner what has to move first.
 * Keeping only one throws away either the headline or the only instruction the
 * planner gets, so both are shown, unedited, in order.
 *
 * `hint` IS THE THIRD, AND OMITTING IT WAS A REAL DEFECT. The route's read
 * failures do not come from this file's own vocabulary — they come from
 * `classifyRouteReadFailure`, whose body is `{ error, hint }` and NEVER
 * `details`. So an unapplied migration answered 503 "RTP cycle schema is not
 * available yet" and this function showed exactly that, dropping the only
 * sentence that says what to do about it ("Apply the latest Supabase
 * migrations, then try again."). The same held for its 500: the headline is the
 * database's own message and the hint is the part warning that this is a read
 * failure, not an empty result. Every field the server can put words in is read
 * here, in the server's order, or the surface silently edits the refusal.
 *
 * When the response carried no words at all — a proxy error page, a body-limit
 * refusal, an empty response — the STATUS is named instead of a guess being
 * offered. "Failed to save" with no reason is the sentence that ends with a
 * planner emailing someone.
 */
function describeWriteRefusal(
  payload: { error?: unknown; details?: unknown; hint?: unknown },
  status: number,
  attempt: string
): string {
  const parts = [payload.error, payload.details, payload.hint].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  );
  if (parts.length > 0) return joinRefusalParts(parts.map((part) => part.trim()));
  return `${attempt} was refused with HTTP ${status}, and no reason was given.`;
}

/**
 * A create that LANDED and could not be read back — a success that must not be
 * silent.
 *
 * `insertNotReadableBackResponse` answers **201** with `{ created: true,
 * record: null, details }` when the table granted the INSERT and denied this
 * reader the SELECT. `response.ok` is true for 201, so treating it as an
 * ordinary success took the planner straight to `router.refresh()` — which
 * re-reads through the very path that just proved it cannot see the row. The
 * form closes, no new period appears, and the planner concludes the save failed
 * and adds it again. The route wrote a sentence for precisely this moment
 * ("Nothing needs to be retried; retrying would create a second one") and it
 * was being thrown away because the status was in the 2xx range.
 *
 * Returns null for an ordinary create, so the caller adds no noise to the
 * common path.
 */
function describeUnreadableCreate(payload: {
  created?: unknown;
  record?: unknown;
  details?: unknown;
}): string | null {
  if (payload.created !== true || payload.record !== null) return null;
  const details = typeof payload.details === "string" ? payload.details.trim() : "";
  if (details) return details;
  return (
    "The planning period was created, but this deployment could not read it back, so it may not " +
    "appear in the list below. Do not add it again — a second one would be created."
  );
}

/**
 * What a SUCCESSFUL removal cost, disclosed rather than left to be discovered.
 *
 * `project_rtp_cycle_links.horizon_band_id` is ON DELETE SET NULL, not RESTRICT,
 * so removing a period silently detaches every project programmed into it — and
 * each one then becomes an `unbanded_constrained_project` blocker that makes
 * `buildRtpFiscalConstraint` decline to determine anything for the whole plan.
 * The route counts them BEFORE the delete, because afterwards nothing records
 * it, and hands the count back for exactly this sentence.
 *
 * `null` is "could not be counted" and is reported as unknown. It must never
 * read as none: none is the one answer that would let a planner stop looking.
 */
function describeRemovalConsequence(projectLinksUnassigned: number | null): string | null {
  if (projectLinksUnassigned === null) {
    return (
      "The period was removed. Any projects that were programmed into it no longer belong to a period, and how " +
      "many could not be counted — check the programmed project list before relying on the fiscal constraint check."
    );
  }
  if (projectLinksUnassigned === 0) return null;
  const one = projectLinksUnassigned === 1;
  return (
    `The period was removed. ${projectLinksUnassigned} programmed ${one ? "project was" : "projects were"} in it ` +
    `and now ${one ? "has" : "have"} no period at all. Assign ${one ? "it" : "them"} to another period, or the ` +
    "fiscal constraint check will decline to give this plan an answer."
  );
}

/**
 * The next free sort order. Clamped to the route's own ceiling so a plan that
 * has somehow reached it gets a 400 naming the field rather than an unexplained
 * "Invalid horizon period payload".
 */
const SORT_ORDER_MAX = 9999;

function nextSortOrder(bands: ReadonlyArray<RtpHorizonBandInput>): number {
  const highest = bands.reduce(
    (max, band) => (Number.isFinite(band.sortOrder) && band.sortOrder > max ? band.sortOrder : max),
    -1
  );
  return Math.min(highest + 1, SORT_ORDER_MAX);
}

type BandDraft = {
  label: string;
  startYear: string;
  endYear: string;
  escalationTargetYear: string;
  costEstimateBasis: RtpHorizonBandInput["costEstimateBasis"];
};

type BandValues = {
  label: string;
  startYear: number;
  endYear: number;
  escalationTargetYear: number | null;
  costEstimateBasis: RtpHorizonBandInput["costEstimateBasis"];
};

const EMPTY_DRAFT: BandDraft = {
  label: "",
  startYear: "",
  endYear: "",
  escalationTargetYear: "",
  costEstimateBasis: "itemized",
};

function draftFromBand(band: RtpHorizonBandInput): BandDraft {
  return {
    label: band.label,
    startYear: numberToInput(band.startYear),
    endYear: numberToInput(band.endYear),
    escalationTargetYear: numberToInput(band.escalationTargetYear),
    costEstimateBasis: band.costEstimateBasis,
  };
}

function HorizonBandForm({
  idPrefix,
  heading,
  initialDraft,
  submitLabel,
  isSaving,
  isBlocked,
  serverError,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  heading: string;
  initialDraft: BandDraft;
  submitLabel: string;
  /** THIS form's own write is in flight — drives the spinner. */
  isSaving: boolean;
  /**
   * Some OTHER write is in flight. Disables submitting without showing a
   * spinner this form has not earned: two overlapping writes share one pending
   * slot, and the second to finish would clear the first's state underneath it.
   */
  isBlocked: boolean;
  serverError: string | null;
  onSubmit: (values: BandValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BandDraft>(initialDraft);
  const [localError, setLocalError] = useState<string | null>(null);

  const startYear = parseOptionalYear(draft.startYear);
  const endYear = parseOptionalYear(draft.endYear);
  const escalationTargetYear = parseOptionalYear(draft.escalationTargetYear);

  // Live, so the assumption is visible while the years are still being typed.
  const previewMidpoint =
    startYear !== null && endYear !== null && endYear >= startYear ? bandMidpoint(startYear, endYear) : null;

  function update<K extends keyof BandDraft>(key: K, value: BandDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    // These mirror the table's own CHECK constraints. Saying it here, beside
    // the two fields, is worth more to a planner than the same refusal arriving
    // as a 400 after the form has closed.
    if (!draft.label.trim()) {
      setLocalError("Give this period a name, so costs and revenue can be attributed to it.");
      return;
    }
    if (startYear === null || endYear === null) {
      setLocalError("Enter both a first year and a last year for this period.");
      return;
    }
    if (endYear < startYear) {
      setLocalError("The last year of a period cannot come before its first year.");
      return;
    }
    if (escalationTargetYear !== null && (escalationTargetYear < startYear || escalationTargetYear > endYear)) {
      setLocalError(
        `The year money is treated as spent has to fall inside this period — between ${startYear} and ${endYear}.`
      );
      return;
    }

    onSubmit({
      label: draft.label.trim(),
      startYear,
      endYear,
      escalationTargetYear,
      costEstimateBasis: draft.costEstimateBasis,
    });
  }

  const shownError = localError ?? serverError;
  const selectedBasis = COST_BASIS_OPTIONS.find((option) => option.value === draft.costEstimateBasis);

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[0.5rem] border border-border/60 bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{heading}</p>

      {shownError ? (
        <p
          role="alert"
          className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {shownError}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-label`} className="text-xs font-medium text-foreground">
          What this period is called
        </label>
        <Input
          id={`${idPrefix}-label`}
          value={draft.label}
          onChange={(event) => update("label", event.target.value)}
          placeholder="First ten years"
          maxLength={LABEL_MAX_LENGTH}
          required
        />
        <p className="text-[0.7rem] text-muted-foreground">
          Your agency&apos;s own name for the period — &ldquo;First ten years&rdquo;, &ldquo;2035&ndash;2050&rdquo;,
          &ldquo;Phase 2&rdquo;. It appears on every financial table in this plan.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-start-year`} className="text-xs font-medium text-foreground">
            First year
          </label>
          <Input
            id={`${idPrefix}-start-year`}
            type="number"
            inputMode="numeric"
            min={YEAR_MIN}
            max={YEAR_MAX}
            value={draft.startYear}
            onChange={(event) => update("startYear", event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-end-year`} className="text-xs font-medium text-foreground">
            Last year
          </label>
          <Input
            id={`${idPrefix}-end-year`}
            type="number"
            inputMode="numeric"
            min={YEAR_MIN}
            max={YEAR_MAX}
            value={draft.endYear}
            onChange={(event) => update("endYear", event.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-escalation-year`} className="text-xs font-medium text-foreground">
          Year money in this period is treated as spent
        </label>
        <Input
          id={`${idPrefix}-escalation-year`}
          type="number"
          inputMode="numeric"
          min={YEAR_MIN}
          max={YEAR_MAX}
          value={draft.escalationTargetYear}
          onChange={(event) => update("escalationTargetYear", event.target.value)}
          placeholder={previewMidpoint === null ? "Leave blank to use the middle of the period" : String(previewMidpoint)}
          aria-describedby={`${idPrefix}-escalation-help`}
        />
        <p id={`${idPrefix}-escalation-help`} className="text-[0.7rem] text-muted-foreground">
          {escalationTargetYear !== null ? (
            <>Costs and revenue in this period will be escalated to {escalationTargetYear} dollars.</>
          ) : previewMidpoint !== null ? (
            <>
              Leave this blank and the middle of the period &mdash; <strong>{previewMidpoint}</strong> &mdash; is assumed,
              and every table says so.
            </>
          ) : (
            <>Leave this blank and the middle of the period is assumed, and every table says so.</>
          )}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-cost-basis`} className="text-xs font-medium text-foreground">
          How costs are reported for this period
        </label>
        <select
          id={`${idPrefix}-cost-basis`}
          className={SELECT_CLASS}
          value={draft.costEstimateBasis}
          onChange={(event) => update("costEstimateBasis", event.target.value as BandDraft["costEstimateBasis"])}
        >
          {COST_BASIS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedBasis ? <p className="text-[0.7rem] text-muted-foreground">{selectedBasis.hint}</p> : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving || isBlocked}>
          {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RtpHorizonBandEditor({ rtpCycleId, bands, canWrite }: RtpHorizonBandEditorProps) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [editingBandId, setEditingBandId] = useState<string | null>(null);
  const [pendingBandId, setPendingBandId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Scoped to the band it belongs to: a refused delete has to appear beside the
  // row the planner clicked, not in a banner several periods away from it.
  const [error, setError] = useState<{ bandId: string | null; message: string } | null>(null);
  // A write that SUCCEEDED and still cost the planner something they have to
  // know about: a removal that detached programmed projects, or a create the
  // deployment could not read back. Neither can be scoped to a row — one's row
  // is gone, the other's never became visible — so it belongs at the top of the
  // section.
  const [notice, setNotice] = useState<string | null>(null);

  // Sorted here rather than trusted from the caller so the order a planner sees
  // is chronological and deterministic. Periods read as a timeline; a band added
  // late but starting early belongs at the top, not at the bottom.
  const orderedBands = [...bands].sort(
    (a, b) => a.startYear - b.startYear || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
  );

  function errorFor(bandId: string | null): string | null {
    return error && error.bandId === bandId ? error.message : null;
  }

  async function submitBand(values: BandValues, bandId: string | null) {
    setError(null);
    setNotice(null);
    setIsSaving(true);
    setPendingBandId(bandId);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/horizon-bands`, {
        method: bandId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(bandId ? { bandId } : {}),
          label: values.label,
          startYear: values.startYear,
          endYear: values.endYear,
          // null, not undefined: clearing this field means "go back to assuming
          // the midpoint", which an omitted key would silently decline to do.
          escalationTargetYear: values.escalationTargetYear,
          costEstimateBasis: values.costEstimateBasis,
          // One PAST the highest in use, not the count. After a removal the
          // count collides with a sort order already taken, and
          // `buildRtpFiscalConstraint` sorts bands by `sortOrder` first — two
          // periods sharing one would leave their order decided by the tie-
          // breakers rather than by the agency.
          ...(bandId ? {} : { sortOrder: nextSortOrder(bands) }),
        }),
      });

      // `.catch` because a refusal is not guaranteed to carry a JSON body — a
      // 413, a proxy error page or an empty response would otherwise surface a
      // JSON parse error in place of the reason the write was refused.
      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        details?: unknown;
        hint?: unknown;
        created?: unknown;
        record?: unknown;
      };
      if (!response.ok) {
        // A duplicate period name also answers 409 with two parts, and the
        // second one is the part that explains why two periods may not share a
        // name. Both are surfaced word-for-word.
        throw new Error(describeWriteRefusal(payload, response.status, "Saving this planning period"));
      }

      // A 201 that wrote the row and could not read it back is a SUCCESS whose
      // consequence is invisible — the refresh below cannot show what the
      // database will not hand over. Say so, or the planner adds it twice.
      setNotice(describeUnreadableCreate(payload));

      setIsAdding(false);
      setEditingBandId(null);
      router.refresh();
    } catch (caught) {
      setError({
        bandId,
        message: caught instanceof Error ? caught.message : "Failed to save this planning period",
      });
    } finally {
      setIsSaving(false);
      setPendingBandId(null);
    }
  }

  async function removeBand(band: RtpHorizonBandInput) {
    // Asked before, not explained after. The removal itself cannot be undone,
    // and its cost lands somewhere the planner is not looking: every project
    // programmed into this period silently loses its period assignment, because
    // that foreign key is ON DELETE SET NULL.
    const confirmed = window.confirm(
      `Remove the period “${band.label}” (${band.startYear}–${band.endYear}) from this plan? ` +
        "This cannot be undone. Any projects programmed into it will be left without a period, and the " +
        "fiscal-constraint check will be recomputed without it."
    );
    if (!confirmed) return;

    const bandId = band.id;
    setError(null);
    setNotice(null);
    setIsSaving(true);
    setPendingBandId(bandId);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/horizon-bands`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bandId }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        details?: unknown;
        hint?: unknown;
        projectLinksUnassigned?: unknown;
      };
      if (!response.ok) {
        // Verbatim, and parsed defensively. On a 409 these two sentences name
        // how much money is still attached to the period and what has to move
        // first — replacing them with "Failed to remove", or letting a failed
        // JSON parse throw over the top of them, would destroy the only
        // instruction the planner gets.
        throw new Error(describeWriteRefusal(payload, response.status, "Removing this planning period"));
      }

      setNotice(
        describeRemovalConsequence(
          typeof payload.projectLinksUnassigned === "number" ? payload.projectLinksUnassigned : null
        )
      );
      router.refresh();
    } catch (caught) {
      setError({
        bandId,
        message: caught instanceof Error ? caught.message : "Failed to remove this planning period",
      });
    } finally {
      setIsSaving(false);
      setPendingBandId(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Planning periods</h3>
          <p className="text-xs text-muted-foreground">
            The spans of years this plan programmes money across. Every revenue line, cost line and programmed project
            belongs to one of them.
          </p>
        </div>
        {canWrite && orderedBands.length > 0 && !isAdding ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add a period
          </Button>
        ) : null}
      </div>

      {orderedBands.length === 0 && !isAdding ? (
        <div className="rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
            <CalendarRange className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">This plan has no planning periods yet</p>
          <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted-foreground">
            A financial plan works period by period: money raised in a span of years pays for what is built in that
            same span. Until at least one period exists there is nowhere to record revenue, nowhere to record operations
            and maintenance, and no way to work out whether this plan can be paid for &mdash; so the fiscal constraint
            check will decline to give an answer rather than guess one.
          </p>
          <p className="mx-auto mt-2 max-w-prose text-xs text-muted-foreground">
            Most agencies start with the split their adoption rule expects &mdash; often a first ten years listed project
            by project, then a longer period costed in aggregate &mdash; but the periods are yours to name and to set
            years for.
          </p>
          {canWrite ? (
            <Button type="button" size="sm" className="mt-4" onClick={() => setIsAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add the first period
            </Button>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              You have view-only access to this plan. Someone with edit access needs to add the first period.
            </p>
          )}
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {notice}
        </p>
      ) : null}

      {/* A failure with no row to attach to — a create, or a refusal after the
          edited row stopped being rendered — still has to be visible. */}
      {errorFor(null) && !isAdding ? (
        <p
          role="alert"
          className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {errorFor(null)}
        </p>
      ) : null}

      {orderedBands.length > 0 ? (
        <ul className="space-y-2">
          {orderedBands.map((band) => {
            const isEditing = editingBandId === band.id;
            const isPending = pendingBandId === band.id && isSaving;
            const rowError = errorFor(band.id);
            const assumedYear = bandMidpoint(band.startYear, band.endYear);
            const basis = COST_BASIS_OPTIONS.find((option) => option.value === band.costEstimateBasis);

            if (isEditing) {
              return (
                <li key={band.id}>
                  <HorizonBandForm
                    idPrefix={`rtp-band-${band.id}`}
                    heading={`Edit ${band.label}`}
                    initialDraft={draftFromBand(band)}
                    submitLabel="Save period"
                    isSaving={isPending}
                    isBlocked={isSaving && !isPending}
                    serverError={rowError}
                    onSubmit={(values) => void submitBand(values, band.id)}
                    onCancel={() => {
                      setEditingBandId(null);
                      setError(null);
                    }}
                  />
                </li>
              );
            }

            return (
              <li key={band.id} className="rounded-[0.5rem] border border-border/70 bg-background/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{band.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {band.startYear}&ndash;{band.endYear} &middot; {band.endYear - band.startYear + 1}{" "}
                      {band.endYear - band.startYear + 1 === 1 ? "year" : "years"}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {band.escalationTargetYear === null ? (
                        <>
                          Money treated as spent in <strong>{assumedYear}</strong> &mdash; assumed from the middle of the
                          period, because no year was set.
                        </>
                      ) : (
                        <>
                          Money treated as spent in <strong>{band.escalationTargetYear}</strong>.
                        </>
                      )}
                    </p>
                    {basis ? <p className="mt-1 text-xs text-muted-foreground">{basis.label}</p> : null}
                  </div>

                  {canWrite ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => {
                          setEditingBandId(band.id);
                          setIsAdding(false);
                          setError(null);
                        }}
                      >
                        <PencilLine className="mr-1.5 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => void removeBand(band)}
                      >
                        {isPending ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-4 w-4" />
                        )}
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>

                {rowError ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  >
                    {rowError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {isAdding ? (
        <HorizonBandForm
          idPrefix="rtp-band-new"
          heading="Add a planning period"
          initialDraft={EMPTY_DRAFT}
          submitLabel="Add period"
          isSaving={isSaving && pendingBandId === null}
          isBlocked={isSaving && pendingBandId !== null}
          serverError={errorFor(null)}
          onSubmit={(values) => void submitBand(values, null)}
          onCancel={() => {
            setIsAdding(false);
            setError(null);
          }}
        />
      ) : null}
    </section>
  );
}
