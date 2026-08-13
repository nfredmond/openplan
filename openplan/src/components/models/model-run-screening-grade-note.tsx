"use client";

import { useState } from "react";
import { HelpCircle, Loader2 } from "lucide-react";

import { ScreeningGradeLink } from "@/components/ui/screening-grade-link";
import {
  SCREENING_GRADE_SUMMARY,
  SCREENING_GRADE_TITLE,
} from "@/lib/help/screening-grade";
import { normalizeEvidencePacket } from "@/lib/models/evidence-packet";

/**
 * "SCREENING-GRADE" ON THIS RUN, ANSWERED WITH THIS RUN'S OWN NUMBERS.
 *
 * The general explanation lives in one place (/help#screening-grade) and this
 * links to it rather than repeating it — including the published error
 * envelope, which is derived from the example records and must never be typed
 * onto a second surface.
 *
 * What this adds is the part /help CANNOT know: how coarse this run's zones
 * were, and how its totals compared against reference benchmarks. Those decide
 * whether a particular screening result is worth quoting at all, and a planner
 * reading a caveat is exactly the person who needs them.
 *
 * Everything is read lazily, on open — the note sits on every finished run and
 * an eager fetch would be two extra requests per run for a panel most planners
 * never expand.
 */

type ZoneFigures = {
  sharePct: number;
  zoneCount: number | null;
  supportsLinkLevelValidation: boolean;
  interpretation: string;
};

type BenchmarkFigures = {
  fitScore: number | null;
  vmtPercentError: number | null;
  recommendation: string | null;
};

type NoteState =
  | { status: "closed" }
  | { status: "loading" }
  | {
      status: "loaded";
      /** Null = the read succeeded and this run has no such figure. */
      zones: ZoneFigures | null;
      benchmark: BenchmarkFigures | null;
      /**
       * Which reads FAILED. Kept apart from "absent" because they are different
       * facts: a run with no zone diagnostic and a run whose diagnostic could
       * not be read look identical once both render nothing, and only the first
       * may be reported as "this run does not have one".
       */
      unreadable: { zones: boolean; benchmark: boolean };
    };

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function ModelRunScreeningGradeNote({
  modelId,
  modelRunId,
  engineKey,
  runStatus,
}: {
  modelId: string;
  modelRunId: string;
  engineKey: string;
  runStatus: string;
}) {
  const [state, setState] = useState<NoteState>({ status: "closed" });

  async function open() {
    if (state.status !== "closed") return;
    setState({ status: "loading" });

    // Both reads are attempted whatever the other does: one lane failing must
    // not erase the other lane's figures.
    const [kpiOutcome, packetOutcome] = await Promise.allSettled([
      fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, { cache: "no-store" }).then(
        async (response) => {
          const payload = (await response.json()) as {
            kpis?: Array<Record<string, unknown>>;
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error || "Failed to load run KPIs");
          return payload.kpis ?? [];
        }
      ),
      fetch(`/api/models/${modelId}/runs/${modelRunId}/evidence-packet`, {
        cache: "no-store",
      }).then(async (response) => {
        const payload = (await response.json()) as Record<string, unknown> & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Failed to load the run's evidence");
        return payload;
      }),
    ]);

    let zones: ZoneFigures | null = null;
    if (kpiOutcome.status === "fulfilled") {
      const row = kpiOutcome.value.find((kpi) => kpi.kpi_name === "intrazonal_trip_share");
      const share = row ? asNumber(row.value) : null;
      if (row && share !== null) {
        const breakdown =
          row.breakdown_json && typeof row.breakdown_json === "object"
            ? (row.breakdown_json as Record<string, unknown>)
            : {};
        zones = {
          sharePct: share,
          zoneCount: asNumber(breakdown.zone_count),
          supportsLinkLevelValidation: breakdown.supports_link_level_validation !== false,
          interpretation:
            typeof breakdown.interpretation === "string" ? breakdown.interpretation : "",
        };
      }
    }

    let benchmark: BenchmarkFigures | null = null;
    if (packetOutcome.status === "fulfilled") {
      const normalized = normalizeEvidencePacket({
        rawPacket: packetOutcome.value,
        modelId,
        modelRunId,
        modelTitle:
          typeof packetOutcome.value.model_title === "string"
            ? packetOutcome.value.model_title
            : "OpenPlan model",
        runRecord: { id: modelRunId, engine_key: engineKey, status: runStatus },
        artifacts: [],
        stages: [],
        kpis: [],
      });
      const fit = normalized.benchmark_fit;
      if (fit) {
        benchmark = {
          fitScore: asNumber(fit.fit_score_0_100),
          vmtPercentError: asNumber(fit.vmt_percent_error),
          recommendation: typeof fit.recommendation === "string" ? fit.recommendation : null,
        };
      }
    }

    setState({
      status: "loaded",
      zones,
      benchmark,
      unreadable: {
        zones: kpiOutcome.status === "rejected",
        benchmark: packetOutcome.status === "rejected",
      },
    });
  }

  return (
    <details
      className="mt-2 rounded-[0.5rem] border border-border/60 bg-muted/20"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void open();
      }}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-foreground">
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        What screening-grade means for this run
      </summary>

      <div className="space-y-3 border-t border-border/60 px-3 py-3 text-sm">
        <p className="text-muted-foreground">
          {SCREENING_GRADE_SUMMARY}{" "}
          <ScreeningGradeLink className="font-medium underline underline-offset-2">
            {SCREENING_GRADE_TITLE}, in full
          </ScreeningGradeLink>
          .
        </p>

        {state.status === "loading" ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading this run&apos;s
            own figures…
          </p>
        ) : null}

        {state.status === "loaded" ? (
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
              This run&apos;s own figures
            </p>

            {state.unreadable.zones ? (
              <p>
                This run&apos;s zone-resolution figure could not be read, so this note cannot say how
                much of its travel stayed inside a single zone. That is a failed read, not a good
                result.
              </p>
            ) : state.zones ? (
              <p>
                <span className="font-medium text-foreground">
                  {state.zones.sharePct.toFixed(1)}%
                </span>{" "}
                of this run&apos;s travel began and ended in the same zone
                {state.zones.zoneCount === null ? "" : ` (${state.zones.zoneCount} zones)`}, so it
                never touched a road in the model.{" "}
                {state.zones.supportsLinkLevelValidation
                  ? "Comparing this run's road-by-road volumes against traffic counts can establish something."
                  : "Comparing this run's road-by-road volumes against traffic counts cannot establish anything at this resolution — a gap there is the zone system, not the demand."}
                {state.zones.interpretation ? ` ${state.zones.interpretation}` : ""}
              </p>
            ) : (
              <p>
                This run recorded no zone-resolution figure — it predates the diagnostic, or it
                produced no trips to measure.
              </p>
            )}

            {state.unreadable.benchmark ? (
              <p>
                This run&apos;s evidence record could not be read, so this note cannot say how its
                totals compared against reference benchmarks.
              </p>
            ) : state.benchmark ? (
              <p>
                Against reference benchmarks, this run scored{" "}
                <span className="font-medium text-foreground">
                  {state.benchmark.fitScore === null
                    ? "no overall fit"
                    : `${Math.round(state.benchmark.fitScore)}/100`}
                </span>
                {state.benchmark.vmtPercentError === null
                  ? ""
                  : `, with VMT ${state.benchmark.vmtPercentError >= 0 ? "above" : "below"} the reference by ${Math.abs(state.benchmark.vmtPercentError).toFixed(1)}%`}
                .{state.benchmark.recommendation ? ` ${state.benchmark.recommendation}` : ""}
              </p>
            ) : (
              <p>
                This run has no benchmark comparison of its own. Its engine does not compute one, so
                nothing here measures how far off it is.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}
