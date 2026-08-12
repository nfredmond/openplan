"use client";

/**
 * ONE TRANSCRIBED PROPOSAL, BESIDE THE WORDS IT CAME FROM.
 *
 * This card is where a person decides. Everything above it in the lane —
 * retrieval, the model call, the verifier, the staging table — exists so that
 * this card can show a value, the page it was copied from, and the document's
 * own sentence, together, to someone who can check them.
 *
 * THREE ACTIONS, AND WHAT EACH ONE ACTUALLY DOES:
 *
 *   Save into the plan   — POSTs to the plan's OWN write route with
 *                          `fromExtractionCandidateId`. Same zod, same band
 *                          check, same amount ceiling, same audit line as a
 *                          figure typed by hand. There is no second writer.
 *   Change and save      — the same request with the planner's values. The
 *                          candidate keeps recording what the machine proposed,
 *                          so "what did the planner change?" stays answerable
 *                          forever by comparing the two.
 *   Set aside            — PATCHes the candidate to `rejected` and touches no
 *                          RTP table at all.
 *
 * WHAT THIS CARD REFUSES TO DO:
 *
 *   - Show a confidence score. There is none, anywhere in this feature. A
 *     reader who sees a number grading the transcription stops reading the
 *     quote, and the quote is the only check that means anything.
 *   - Bulk-accept. There is no "accept all" here on purpose: a button that
 *     empties this queue in one press is a button that accepts figures nobody
 *     read, which is the exact failure the queue exists to prevent.
 *   - Fill in a value the document did not state. A blank field stays blank and
 *     is sent as absent — an unpriced thing is not a zero (20260805000003), and
 *     an escalation year the plan does not name must stay empty so the public
 *     "midpoint assumed" caveat survives.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Loader2, PencilLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RTP_PORTFOLIO_ROLE_OPTIONS } from "@/lib/rtp/catalog";
import {
  RECONCILIATION_COPY,
  UNCHECKED_FIELD_NOTE,
  describeCandidateFields,
  describeConflict,
  formatComparedValue,
} from "@/lib/rtp/extraction/display";
import type { CandidateReconciliation } from "@/lib/rtp/extraction/reconcile";

export type ExtractionCandidateBand = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
};

export type ExtractionCandidateProject = { id: string; name: string };

export type ExtractionCandidateView = {
  id: string;
  targetKind: string;
  proposedJson: Record<string, unknown>;
  page: number;
  quote: string;
  status: string;
  reconciliation: CandidateReconciliation;
};

type FieldKind = "text" | "number" | "select";

type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Sent as a number when set; omitted entirely when blank. */
  numeric?: boolean;
  hint?: string;
};

const ENTRY_KIND_OPTIONS = [
  { value: "revenue", label: "Revenue" },
  { value: "operations_maintenance", label: "Operations & maintenance" },
  { value: "other_cost", label: "Other cost" },
];

const COST_BASIS_OPTIONS = [
  { value: "itemized", label: "Itemized — the sum of the projects in it" },
  { value: "banded", label: "Banded — one lump figure for the period" },
];

/**
 * The plan's own vocabulary, from the one place that holds it. Spelling these
 * out here would let this card offer a role the route's zod refuses, which is a
 * 400 a planner cannot act on.
 */
const PORTFOLIO_ROLE_OPTIONS = RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => ({
  value: option.value as string,
  label: option.label as string,
}));

/**
 * A measure needs a key and a plan document does not print one — a plan prints
 * a name. The key is a slug of the transcribed name, offered as a starting
 * point the planner can change: it is a handle for matching the measure across
 * plans, not a planning claim, and it is visible and editable rather than
 * generated behind the card.
 */
function slugifyMeasureKey(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase()
    .slice(0, 120);
}

function bandOptions(bands: readonly ExtractionCandidateBand[]) {
  return bands.map((band) => ({
    value: band.id,
    label: `${band.label} (${band.startYear}–${band.endYear})`,
  }));
}

function fieldsForKind(
  targetKind: string,
  bands: readonly ExtractionCandidateBand[],
  projects: readonly ExtractionCandidateProject[]
): FieldSpec[] {
  switch (targetKind) {
    case "financial_line":
      return [
        { key: "entryKind", label: "Kind", kind: "select", required: true, options: ENTRY_KIND_OPTIONS },
        { key: "sourceName", label: "Name", kind: "text", required: true },
        { key: "amount", label: "Amount (whole dollars)", kind: "number", required: true, numeric: true },
        {
          key: "amountBasisYear",
          label: "Dollar year",
          kind: "number",
          numeric: true,
          hint: "Leave blank unless the page states it.",
        },
        {
          key: "horizonBandId",
          label: "Period",
          kind: "select",
          required: true,
          options: bandOptions(bands),
        },
      ];
    case "performance_measure":
      return [
        { key: "label", label: "Name", kind: "text", required: true },
        {
          key: "measureKey",
          label: "Key",
          kind: "text",
          required: true,
          hint: "How this measure is matched across plans. Not part of the document.",
        },
        { key: "unit", label: "Unit", kind: "text" },
        { key: "baselineValue", label: "Baseline", kind: "number", numeric: true },
        { key: "baselineYear", label: "Baseline year", kind: "number", numeric: true },
        { key: "targetValue", label: "Target", kind: "number", numeric: true },
        { key: "targetYear", label: "Target year", kind: "number", numeric: true },
        { key: "dataSource", label: "Source", kind: "text" },
      ];
    case "horizon_band":
      return [
        { key: "label", label: "Name", kind: "text", required: true },
        { key: "startYear", label: "First year", kind: "number", required: true, numeric: true },
        { key: "endYear", label: "Last year", kind: "number", required: true, numeric: true },
        {
          key: "escalationTargetYear",
          label: "Escalation year",
          kind: "number",
          numeric: true,
          hint: "Leave blank unless the plan names this exact year — OpenPlan discloses that it assumed the period's midpoint, and filling this in deletes that disclosure.",
        },
        { key: "costEstimateBasis", label: "Cost basis", kind: "select", options: COST_BASIS_OPTIONS },
      ];
    case "programmed_project":
      return [
        {
          key: "projectId",
          label: "Project in OpenPlan",
          kind: "select",
          required: true,
          options: projects.map((project) => ({ value: project.id, label: project.name })),
          hint: "The document names a project; you choose which project in OpenPlan it is. Nothing here matches names for you.",
        },
        { key: "estimatedCost", label: "Programmed cost", kind: "number", numeric: true },
        { key: "costBasisYear", label: "Dollar year", kind: "number", numeric: true },
        { key: "portfolioRole", label: "Role in the plan", kind: "select", options: PORTFOLIO_ROLE_OPTIONS },
        { key: "horizonBandId", label: "Period", kind: "select", options: bandOptions(bands) },
      ];
    case "cycle_financial_basis":
      return [
        {
          key: "financialBasisYear",
          label: "Dollar year for the whole plan",
          kind: "number",
          required: true,
          numeric: true,
        },
      ];
    default:
      return [];
  }
}

function initialValues(
  candidate: ExtractionCandidateView,
  fields: readonly FieldSpec[]
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const proposed = candidate.proposedJson[field.key];
    values[field.key] = proposed === null || proposed === undefined ? "" : String(proposed);
  }
  if (candidate.targetKind === "performance_measure" && !values.measureKey) {
    values.measureKey = slugifyMeasureKey(String(candidate.proposedJson.label ?? ""));
  }
  return values;
}

/** Where a kind of proposal is saved, and how its body is spelled. */
function buildAcceptRequest(
  targetKind: string,
  rtpCycleId: string,
  candidateId: string,
  values: Record<string, string>,
  fields: readonly FieldSpec[]
): { url: string; method: "POST" | "PATCH"; body: Record<string, unknown> } | { error: string } {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (values[field.key] ?? "").trim();
    if (raw === "") {
      if (field.required) {
        return { error: `${field.label} is needed before this can be saved into the plan.` };
      }
      // BLANK STAYS ABSENT. Sending null would record "the plan states this is
      // nothing", and an unstated cost is not a zero.
      continue;
    }
    if (field.numeric) {
      const parsed = Number(raw.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(parsed)) {
        return { error: `${field.label} must be a number.` };
      }
      payload[field.key] = parsed;
    } else {
      payload[field.key] = raw;
    }
  }

  payload.fromExtractionCandidateId = candidateId;

  switch (targetKind) {
    case "financial_line":
      return { url: `/api/rtp-cycles/${rtpCycleId}/financial-assumptions`, method: "POST", body: payload };
    case "performance_measure":
      return { url: `/api/rtp-cycles/${rtpCycleId}/performance-measures`, method: "POST", body: payload };
    case "horizon_band":
      return { url: `/api/rtp-cycles/${rtpCycleId}/horizon-bands`, method: "POST", body: payload };
    case "programmed_project": {
      const { projectId, ...rest } = payload as { projectId?: string } & Record<string, unknown>;
      if (typeof projectId !== "string") {
        return { error: "Choose which project in OpenPlan this row is." };
      }
      return {
        url: `/api/projects/${projectId}/rtp-links`,
        method: "POST",
        body: { ...rest, rtpCycleId },
      };
    }
    case "cycle_financial_basis":
      return { url: `/api/rtp-cycles/${rtpCycleId}`, method: "PATCH", body: payload };
    default:
      return {
        error:
          "This kind of passage is reviewed somewhere else in OpenPlan, so it cannot be saved from here.",
      };
  }
}

export function ExtractionCandidateCard({
  rtpCycleId,
  candidate,
  bands,
  projects,
  documentHref,
  canWrite,
  blastRadius,
}: {
  rtpCycleId: string;
  candidate: ExtractionCandidateView;
  bands: readonly ExtractionCandidateBand[];
  projects: readonly ExtractionCandidateProject[];
  /** The source document's download route. Members only; null when it could not be resolved. */
  documentHref: string | null;
  canWrite: boolean;
  /** The Q5 warning, composed by the page. Only ever set for the plan's dollar year. */
  blastRadius: string | null;
}) {
  const router = useRouter();
  const fields = useMemo(
    () => fieldsForKind(candidate.targetKind, bands, projects),
    [candidate.targetKind, bands, projects]
  );
  const [values, setValues] = useState(() => initialValues(candidate, fields));
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState<null | "accept" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "saved" | "set_aside">(null);

  const proposedFields = describeCandidateFields(candidate.targetKind, candidate.proposedJson);
  const copy = RECONCILIATION_COPY[candidate.reconciliation.verdict];

  const changed = fields.some((field) => {
    const proposed = candidate.proposedJson[field.key];
    const original = proposed === null || proposed === undefined ? "" : String(proposed);
    return (values[field.key] ?? "") !== original;
  });

  async function accept() {
    setPending("accept");
    setError(null);
    setWarning(null);
    try {
      const request = buildAcceptRequest(candidate.targetKind, rtpCycleId, candidate.id, values, fields);
      if ("error" in request) {
        setError(request.error);
        return;
      }

      const response = await fetch(request.url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        extractionCandidate?: { recorded?: boolean; warning?: string };
      };

      if (!response.ok) {
        setError([payload.error, payload.details].filter(Boolean).join(" ") || "This could not be saved into the plan.");
        return;
      }

      // The figure landed and the review record did not. Never reported as a
      // failure — that is how the same revenue line gets recorded twice — but
      // never swallowed either.
      if (payload.extractionCandidate && payload.extractionCandidate.recorded === false) {
        setWarning(payload.extractionCandidate.warning ?? null);
      }
      setOutcome("saved");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This could not be saved into the plan.");
    } finally {
      setPending(null);
    }
  }

  async function setAside() {
    setPending("reject");
    setError(null);
    setWarning(null);
    try {
      const response = await fetch(
        `/api/rtp-cycles/${rtpCycleId}/extraction-candidates/${candidate.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reject" }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) {
        setError([payload.error, payload.details].filter(Boolean).join(" ") || "This could not be set aside.");
        return;
      }
      setOutcome("set_aside");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This could not be set aside.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <article className="space-y-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={[
              "rounded border px-2 py-0.5 text-[0.7rem] font-medium",
              copy.tone === "warning"
                ? "border-amber-300/70 bg-amber-50/60 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                : copy.tone === "info"
                  ? "border-sky-300/60 bg-sky-50/60 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
                  : "border-border/70 bg-muted/30 text-muted-foreground",
            ].join(" ")}
          >
            {copy.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground">
            <FileText className="h-3 w-3" aria-hidden="true" />
            {documentHref ? (
              <a href={documentHref} className="underline underline-offset-2">
                Page {candidate.page}
              </a>
            ) : (
              <>Page {candidate.page}</>
            )}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{copy.detail}</p>

      {/* THE DOCUMENT'S OWN WORDS. The reason this card can be trusted at all. */}
      <blockquote className="border-l-2 border-border/70 pl-3 text-sm italic text-foreground">
        {candidate.quote}
      </blockquote>

      {isEditing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="space-y-1 text-xs">
              <span className="font-medium text-foreground">
                {field.label}
                {field.required ? " *" : ""}
              </span>
              {field.kind === "select" ? (
                <select
                  className="h-9 w-full rounded-[0.4rem] border border-border bg-background px-2 text-sm"
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  disabled={busy}
                >
                  <option value="">Not set</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={values[field.key] ?? ""}
                  inputMode={field.kind === "number" ? "decimal" : "text"}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  disabled={busy}
                />
              )}
              {field.hint ? <span className="block text-[0.7rem] text-muted-foreground">{field.hint}</span> : null}
            </label>
          ))}
        </div>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {proposedFields.map((field) => (
            <div key={field.key} className="flex flex-wrap items-baseline gap-2">
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="font-medium text-foreground">{field.value}</dd>
              {field.checkedAgainstQuote ? null : (
                <span
                  className="rounded border border-amber-300/70 bg-amber-50/60 px-1 text-[0.65rem] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                  title={UNCHECKED_FIELD_NOTE}
                >
                  confirm this
                </span>
              )}
            </div>
          ))}
        </dl>
      )}

      {/*
        THE CONFLICT. Both figures, side by side, with the page and the quote
        above them. This is how a planner catches a ledger typed out of a draft
        the adopted plan superseded — and nothing here says which one is right.
      */}
      {candidate.reconciliation.verdict === "conflicts" ? (
        <div className="space-y-2 rounded-[0.4rem] border border-amber-300/60 bg-amber-50/40 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {describeConflict(candidate.reconciliation)}
          </p>
          {candidate.reconciliation.matches.map((match) => (
            <div key={match.rowId} className="space-y-1">
              <p className="text-xs font-medium text-foreground">{match.rowLabel}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-medium">Field</th>
                    <th scope="col" className="py-1 pr-3 font-medium">This plan records</th>
                    <th scope="col" className="py-1 font-medium">The document says</th>
                  </tr>
                </thead>
                <tbody>
                  {match.fields.map((field) => (
                    <tr key={field.key} className={field.same ? "text-muted-foreground" : "text-foreground"}>
                      <th scope="row" className="py-1 pr-3 text-left font-normal">{field.label}</th>
                      <td className="py-1 pr-3 tabular-nums">
                        {formatComparedValue(field.kind, field.recordedValue)}
                      </td>
                      <td className="py-1 tabular-nums">
                        {formatComparedValue(field.kind, field.documentValue)}
                        {field.same ? null : <span className="ml-1 text-[0.65rem] uppercase tracking-wide">differs</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-[0.7rem] text-muted-foreground">{candidate.reconciliation.identityNote}</p>
        </div>
      ) : null}

      {/* Q5: the widest change this feature can make, stated before the click. */}
      {blastRadius ? (
        <p className="rounded-[0.4rem] border border-amber-300/60 bg-amber-50/40 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          {blastRadius}
        </p>
      ) : null}

      {outcome === "saved" ? (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Saved into the plan, citing page {candidate.page}.
        </p>
      ) : null}
      {outcome === "set_aside" ? (
        <p className="text-xs font-medium text-muted-foreground">
          Set aside. Nothing was recorded in the plan.
        </p>
      ) : null}
      {warning ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{warning}</p>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {/*
        THE ORDER OF THE BUTTONS IS THE RECONCILIATION'S ANSWER. For something
        this plan already records, saving it again records the same figure
        twice — so "Set aside" is the primary action and the save is demoted,
        rather than the card offering a duplicate as the obvious next click.
        Both actions stay available either way: the verdict advises, it never
        decides.
      */}
      {canWrite && outcome === null ? (
        <div className="flex flex-wrap items-center gap-2">
          {copy.primaryAction === "dismiss" ? (
            <>
              <Button type="button" size="sm" onClick={setAside} disabled={busy}>
                {pending === "reject" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}
                Set aside
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={accept} disabled={busy}>
                {pending === "accept" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {changed ? "Save my values anyway" : "Save it anyway"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" onClick={accept} disabled={busy}>
                {pending === "accept" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                {changed ? "Save my values into the plan" : "Save into the plan"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={setAside} disabled={busy}>
                {pending === "reject" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}
                Set aside
              </Button>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsEditing((current) => !current)}
            disabled={busy}
          >
            <PencilLine className="mr-1.5 h-4 w-4" />
            {isEditing ? "Stop changing" : "Change before saving"}
          </Button>
        </div>
      ) : null}

      {!canWrite ? (
        <p className="text-xs text-muted-foreground">
          You can read what was copied out of this document. Saving it into the plan, or setting it
          aside, needs permission to change plans.
        </p>
      ) : null}
    </article>
  );
}
