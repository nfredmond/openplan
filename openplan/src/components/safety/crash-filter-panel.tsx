"use client";

import {
  CRASH_FILTER_FACETS,
  facetAvailability,
  facetValueLabel,
  facetValues,
  type CrashFacetDefinition,
  type CrashFacetId,
  type CrashFilterSelection,
} from "@/lib/safety/crash-filters";
import { SAFETY_PDO_COMPARABILITY_CAVEAT } from "@/lib/safety/caveats";

/**
 * The crash filter controls, GENERATED from the one facet declaration.
 *
 * Nothing here names a facet. The panel maps over `CRASH_FILTER_FACETS`, which
 * is the same list the API route's query interpreter and the live lane's
 * in-memory predicate walk — so a facet cannot be filterable in the API and
 * unreachable on screen, which is the shipped-invisible defect this product has
 * caught eleven times. Adding a jurisdiction's crash source adds a descriptor;
 * it does not add a control here.
 *
 * THREE STATES PER FACET, AND THE THIRD IS THE WHOLE POINT.
 *
 *   * The source supplies the dimension — a normal control.
 *   * The source supplies it partly — a normal control with a warning, because
 *     some crashes will carry no value and their absence from a filtered result
 *     is not a finding.
 *   * THE SOURCE HAS NO SUCH FIELD — a DISABLED control that says so. Left
 *     enabled, it would return an empty list, and an empty safety result reads
 *     as "no crash in your corridor happened after dark". That is a claim about
 *     a road, made on the strength of a missing column. The disabled state is
 *     the mechanism that makes the honest sentence unavoidable rather than
 *     something a future contributor has to remember.
 *
 * AND WHEN THERE IS NO SOURCE AT ALL, the panel does not render a set of empty
 * controls: it says no crash source is configured for the area. A planner in a
 * state with no adapter must be told that, not left to conclude their roads are
 * safe.
 */

export type CrashFacetCounts = Partial<Record<CrashFacetId, Record<string, number>>>;

type CrashFilterPanelProps = {
  selection: CrashFilterSelection;
  onChange: (next: CrashFilterSelection) => void;
  /** How many of the crashes ON SCREEN carry each value. */
  counts?: CrashFacetCounts;
  /**
   * The acquisition's (or live read's) `dimension_coverage`. Untyped on purpose
   * — it arrives as JSONB — and read through `facetAvailability`, which reports
   * "unknown" for anything it cannot parse rather than assuming the best.
   */
  dimensionCoverage?: unknown;
  /** Whether this source can distinguish each normalized severity band. */
  severityCompleteness?: string;
  /**
   * False when no crash source covers this study area, or none has been
   * consulted yet. The controls are then replaced by a sentence.
   */
  sourceConfigured: boolean;
  /** What to say when there is no source. Supplied by the caller, never guessed. */
  noSourceMessage?: string;
};

function toggleValue(current: readonly string[] | undefined, value: string): string[] {
  const set = new Set(current ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

function FacetControl({
  facet,
  selection,
  onChange,
  counts,
  dimensionCoverage,
  severityCompleteness,
}: {
  facet: CrashFacetDefinition;
  selection: CrashFilterSelection;
  onChange: (next: CrashFilterSelection) => void;
  counts?: Record<string, number>;
  dimensionCoverage?: unknown;
  severityCompleteness?: string;
}) {
  const availability = facetAvailability(facet, dimensionCoverage);
  const chosen = selection[facet.id] ?? [];

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1"
      aria-label={facet.label}
      disabled={availability.disabled}
    >
      <legend className="text-xs font-medium text-muted-foreground">{facet.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {facetValues(facet).map((value) => {
          const active = chosen.includes(value);
          const count = counts?.[value];
          const notCovered = facet.id === "severity" && (
            (severityCompleteness === "fatal_only" && ["severe_injury", "injury", "pdo"].includes(value))
            || (severityCompleteness === "fatal_injury_only" && ["severe_injury", "pdo"].includes(value))
          );
          return (
            <button
              key={value}
              type="button"
              disabled={availability.disabled || notCovered}
              aria-pressed={active}
              onClick={() => onChange({ ...selection, [facet.id]: toggleValue(chosen, value) })}
              className={`rounded-full border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? "bg-foreground text-background" : ""
              }`}
            >
              {facetValueLabel(facet, value)}
              {/* The count is only ever appended when it exists. A "(0)" on a
                  value the current view has none of is fine; a "(0)" on a value
                  nothing was counted for would be a fabricated zero. */}
              {notCovered ? " (not covered)" : typeof count === "number" ? ` (${count.toLocaleString()})` : ""}
            </button>
          );
        })}
      </div>
      {availability.note && (
        <p className="text-xs text-muted-foreground" role="note">
          {availability.note}
        </p>
      )}
    </fieldset>
  );
}

export function CrashFilterPanel({
  selection,
  onChange,
  counts,
  dimensionCoverage,
  severityCompleteness,
  sourceConfigured,
  noSourceMessage,
}: CrashFilterPanelProps) {
  if (!sourceConfigured) {
    return (
      <section className="rounded-lg border p-4 text-sm" aria-label="Crash filters">
        <p className="text-muted-foreground">
          {noSourceMessage ??
            "No crash source is configured for this study area, so there is nothing to filter. That is a limit of the sources OpenPlan can reach, not evidence that no crashes occurred here."}
        </p>
      </section>
    );
  }

  // The property-damage sentence appears whenever those collisions are being
  // withheld, which is the default. It is not a footnote about a checkbox — it
  // is the reason the default is what it is, and a planner who switches PDO on
  // needs the comparability warning more, not less.
  const severityChoice = selection.severity ?? [];
  const pdoExcluded = severityChoice.length > 0 && !severityChoice.includes("pdo");

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Crash filters">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {CRASH_FILTER_FACETS.map((facet) => (
          <FacetControl
            key={facet.id}
            facet={facet}
            selection={selection}
            onChange={onChange}
            counts={counts?.[facet.id]}
            dimensionCoverage={dimensionCoverage}
            severityCompleteness={severityCompleteness}
          />
        ))}
      </div>
      {/* WHAT THE NUMBERS IN BRACKETS COUNT. Not the record — the collisions
          currently drawn, which a stored query has already filtered in Postgres
          and capped. Unlabelled, "Fatal (3)" under an active filter reads as
          "this corridor had three fatal crashes". */}
      {counts && (
        <p className="text-xs text-muted-foreground">
          Counts are of the collisions currently on the map, so they change as you filter and they
          exclude anything beyond the display cap or without coordinates.
        </p>
      )}
      {pdoExcluded && (
        <p className="text-xs text-muted-foreground">{SAFETY_PDO_COMPARABILITY_CAVEAT}</p>
      )}
    </section>
  );
}
