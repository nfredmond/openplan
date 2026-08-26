"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AnalysisSequenceFacts } from "@/components/models/analysis-sequence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { summarizeProjectComparison } from "@/lib/models/project-comparison";
import { withPlanningContext } from "@/lib/projects/planning-context";

type StartResponse = {
  error?: string;
  state?: "needs_build_assumption" | "ready_for_run" | "ready_for_validation";
  scenarioSetId?: string;
  networkBasis?: string;
  buildAssumptionRequired?: boolean;
  nextRun?: {
    method: "aequilibrae" | "activitysim";
    scenario: "baseline" | "build";
    modelId: string;
    scenarioEntryId: string;
  } | null;
};

export function ProjectComparisonStarter({
  projectId,
  projectName,
  facts,
}: {
  projectId: string;
  projectName: string;
  facts: AnalysisSequenceFacts;
}) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsBuildAssumption, setNeedsBuildAssumption] = useState(false);
  const [autoTripChangePct, setAutoTripChangePct] = useState("");
  const [assumptionBasis, setAssumptionBasis] = useState("");
  const summary = summarizeProjectComparison(facts);

  async function startComparison(saveBuildAssumption = false) {
    setError(null);
    setIsStarting(true);
    try {
      const parsedChange = Number(autoTripChangePct);
      if (
        saveBuildAssumption &&
        (!Number.isFinite(parsedChange) || parsedChange === 0 || parsedChange < -90 || parsedChange > 200)
      ) {
        throw new Error("Enter a non-zero daily auto-trip change between -90% and 200%.");
      }
      if (saveBuildAssumption && assumptionBasis.trim().length < 3) {
        throw new Error("Name the study, count, policy assumption, or other source for this change.");
      }
      const response = await fetch("/api/models/project-comparison", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          ...(saveBuildAssumption
            ? { buildAssumption: { autoTripChangePct: parsedChange, basis: assumptionBasis.trim() } }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as StartResponse;
      if (!response.ok || !payload.scenarioSetId || payload.networkBasis !== "worker_osm_snapshot") {
        throw new Error(payload.error ?? "The comparison could not be started.");
      }

      if (payload.state === "needs_build_assumption" || payload.buildAssumptionRequired) {
        setNeedsBuildAssumption(true);
        return;
      }

      if (payload.nextRun) {
        const href = new URL(withPlanningContext(`/models/${payload.nextRun.modelId}`, projectId), window.location.origin);
        href.searchParams.set("scenarioEntryId", payload.nextRun.scenarioEntryId);
        router.push(`${href.pathname}${href.search}#run-model`);
      } else {
        router.push(withPlanningContext(`/scenarios/${payload.scenarioSetId}`, projectId));
      }
      router.refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "The comparison could not be started.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <section id="project-comparison-starter" className="mb-6 border-l-4 border-sky-500 bg-sky-50/70 px-5 py-4 dark:bg-sky-950/20" data-testid="project-comparison-starter">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[44rem]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Project build comparison</h2>
            <StatusBadge tone={summary.state === "packet_ready" ? "success" : summary.state === "unknown" ? "warning" : "neutral"}>
              {summary.label}
            </StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Start here for {projectName}. OpenPlan will create one traceable baseline, one build scenario,
            and separate AequilibraE and ActivitySim results. At launch, the worker builds a
            labeled OpenStreetMap snapshot and saves its exact digest for both methods. You review
            the real assumptions before anything runs. Continue takes you through AequilibraE baseline,
            AequilibraE build, ActivitySim baseline, and ActivitySim build in order; a failed load remains a failed run.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Before either build run, you must enter one reviewable change in assigned daily auto trips and say what supports it.
            OpenPlan does not derive a benefit from the project description. This is a screening estimate, not a forecast.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Time to allow: roughly 10–40 minutes for all four jobs in a small area. Large areas, a busy queue, source downloads,
            or count calibration can take hours. There is no runtime cutoff, and each job shows its own queued, running, failed,
            or finished state rather than implying the whole comparison is instant.
          </p>
        </div>
        {summary.state !== "packet_ready" && !needsBuildAssumption ? (
          <Button type="button" onClick={() => void startComparison(false)} disabled={isStarting}>
            {isStarting ? "Starting…" : facts.scenarioSetCount > 0 || facts.modelCount > 0 ? "Continue guided comparison" : "Begin guided comparison"}
          </Button>
        ) : null}
      </div>


      {needsBuildAssumption ? (
        <div className="mt-5 max-w-2xl border-l-4 border-amber-500 bg-amber-50/70 px-4 py-4 dark:bg-amber-950/20" data-testid="guided-build-assumption">
          <h3 className="text-sm font-semibold text-foreground">Save the build change before running it</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Enter the expected percent change in assigned daily auto trips versus no-build. A negative value means fewer auto trips.
            Use zero only when the project truly has no modeled travel-demand change; zero cannot support a build comparison here.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
            <label className="text-sm font-medium text-foreground" htmlFor="guided-auto-trip-change">
              Daily auto-trip change (%)
              <Input
                id="guided-auto-trip-change"
                type="number"
                min={-90}
                max={200}
                step="0.1"
                value={autoTripChangePct}
                onChange={(event) => setAutoTripChangePct(event.target.value)}
                className="mt-1 w-full"
                placeholder="For example, -8"
              />
            </label>
            <label className="text-sm font-medium text-foreground" htmlFor="guided-auto-trip-basis">
              What that change is based on
              <Textarea
                id="guided-auto-trip-basis"
                rows={3}
                value={assumptionBasis}
                onChange={(event) => setAssumptionBasis(event.target.value)}
                className="mt-1 w-full"
                placeholder="Name the local study, count analysis, adopted policy assumption, or another source reviewers can check."
              />
            </label>
          </div>
          <Button type="button" className="mt-3" onClick={() => void startComparison(true)} disabled={isStarting}>
            {isStarting ? "Saving…" : "Save assumption and continue"}
          </Button>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 md:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Traffic change</dt>
          <dd className="mt-1 text-sm leading-6 text-foreground">{summary.trafficAnswer}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Miles driven</dt>
          <dd className="mt-1 text-sm leading-6 text-foreground">{summary.vmtAnswer}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Is it worth it?</dt>
          <dd className="mt-1 text-sm leading-6 text-foreground">{summary.valueAnswer}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What remains uncertain</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
          {summary.uncertainties.map((uncertainty) => <li key={uncertainty}>{uncertainty}</li>)}
        </ul>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p> : null}
    </section>
  );
}
