"use client";

import { useEffect, useState } from "react";
import { ScreeningGradeLink } from "@/components/ui/screening-grade-link";

/**
 * THE QUESTION THE PLANNER ASKED, ANSWERED IN THE WORDS THEY ASKED IT IN.
 *
 * WHERE THIS CAME FROM. A fresh tester, given the brief "your manager wants to
 * know what happens on a corridor — how much traffic, how much driving", ran an
 * analysis to completion on 2026-08-14 and reported that the finished run never
 * states either number. It was true, and it was not because the numbers were
 * missing: a succeeded run stores `total_trips` and `daily_vmt`. They had
 * nowhere to appear.
 *
 *   - `daily_vmt` rendered only inside the ITE trip-generation screen, which
 *     mounts for one engine nobody running a corridor uses.
 *   - `vmt_per_capita` rendered only inside the CEQA significance screen, which
 *     mounts only when a run is eligible for a determination — and which asks a
 *     regulatory question, not "how much driving".
 *
 * So the answer existed, was correct, and was invisible. That is this
 * repository's most expensive recurring defect and this is another instance of
 * it: a KPI with no panel is a KPI nobody can read.
 *
 * WHAT THIS PANEL WILL NOT DO
 *   1. IT NEVER PRINTS A NUMBER THE RUN DID NOT PRODUCE. A missing KPI renders
 *      as absent, never as zero. "The model produced no trips" and "nobody has
 *      measured this" are different sentences, and zero is the most flattering
 *      possible reading of the second.
 *   2. IT NEVER DROPS THE GRADE. Every figure here is screening-grade — the
 *      sketch engine's VMT is known to run low — so the qualification is
 *      rendered WITH the figures, not in a paragraph further down the page. A
 *      number separated from its caveat is the one that ends up in a report.
 *      The explanation is `ScreeningGradeLink`, the single account of that term,
 *      rather than a second wording that can drift from it.
 */

/**
 * The questions a planner actually arrives with, paired to what the engines
 * store. Adding an engine's own metric here is how it becomes readable; there
 * is deliberately no fallback that renders unknown KPI names, because a raw
 * key like `final_gap` on screen is not an answer to anybody.
 */
type HeadlineFigureDefinition = { kpiName: string; label: string; unit: string };

const ASSIGNMENT_HEADLINE_FIGURES: ReadonlyArray<HeadlineFigureDefinition> = [
  { kpiName: "total_trips", label: "Trips on an average day", unit: "trips" },
  { kpiName: "daily_vmt", label: "Miles driven on an average day", unit: "miles" },
];

const ACTIVITYSIM_HEADLINE_FIGURES: ReadonlyArray<HeadlineFigureDefinition> = [
  { kpiName: "activitysim_trips", label: "ActivitySim trips per day", unit: "trips" },
  {
    kpiName: "activitysim_daily_vmt",
    label: "ActivitySim VMT per day",
    unit: "miles",
  },
];

function headlineFiguresForEngine(engineKey: string) {
  return engineKey === "behavioral_demand"
    ? ACTIVITYSIM_HEADLINE_FIGURES
    : ASSIGNMENT_HEADLINE_FIGURES;
}

type Figure = { label: string; unit: string; value: number };

type PanelState =
  | { status: "loading" }
  | { status: "unreadable"; reason: string }
  | { status: "none" }
  | { status: "ready"; figures: Figure[] };

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ModelRunHeadlineAnswer({
  modelId,
  modelRunId,
  engineKey,
}: {
  modelId: string;
  modelRunId: string;
  engineKey: string;
}) {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          kpis?: Array<Record<string, unknown>>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Failed to load run results");

        const rows = payload.kpis ?? [];
        const figures: Figure[] = [];
        for (const figure of headlineFiguresForEngine(engineKey)) {
          const row = rows.find((kpi) => kpi.kpi_name === figure.kpiName);
          const value = row ? asNumber(row.value) : null;
          // Absent stays absent. A run that measured nothing must not be
          // rendered as a run that measured zero.
          if (value === null) continue;
          figures.push({ label: figure.label, unit: figure.unit, value });
        }

        if (!cancelled) {
          setState(figures.length ? { status: "ready", figures } : { status: "none" });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "unreadable",
            reason: error instanceof Error ? error.message : "Failed to load run results",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engineKey, modelId, modelRunId]);

  if (state.status === "loading") return null;

  if (state.status === "unreadable") {
    // A failed read is not an absence of results. Saying "this run measured
    // nothing" because a request failed would be a claim about the model.
    return (
      <section className="rounded-xl border border-border/70 p-5" aria-label="What this run found">
        <h2 className="text-sm font-semibold text-foreground">What this run found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          OpenPlan could not read this run&rsquo;s results just now. That is a failed read, not an
          empty result — the run may well have measured everything. Reload the page to try again.
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{state.reason}</p>
      </section>
    );
  }

  if (state.status === "none") {
    return (
      <section className="rounded-xl border border-border/70 p-5" aria-label="What this run found">
        <h2 className="text-sm font-semibold text-foreground">What this run found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This run did not measure daily trips or miles driven. Engines measure different things, so
          this is expected for some of them rather than a sign that anything failed.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="What this run found">
      <h2 className="text-sm font-semibold text-foreground">What this run found</h2>
      <dl className="mt-3 grid gap-4">
        {state.figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="text-xl font-semibold tabular-nums text-foreground">
              {Math.round(figure.value).toLocaleString()}{" "}
              <span className="block text-sm font-normal text-muted-foreground">{figure.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        These are screening-grade figures — good for comparing options, not for a number you would
        defend on their own. <ScreeningGradeLink />
      </p>
    </section>
  );
}
