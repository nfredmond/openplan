/**
 * THE HEADLINE NUMBERS DERIVED FROM THE RUNS READ — and what they say instead
 * when that read did not answer.
 *
 * WHY THIS IS A MODULE AND NOT EIGHT TERNARIES ON THE PAGE. Eight tiles are
 * built from one read: four on the overview header and four above the Insights
 * figures. Before 2026-08-13 every one of them was written inline as
 * `${kpis.totalRuns || 0}` over `runsResult.data ?? []`, so a workspace whose
 * runs query FAILED rendered "0 runs · 0 completed · N/A · Not available" —
 * pixel-identical to a workspace that had genuinely never run anything, and
 * accompanied by two charts drawn flat at the baseline. A planner cannot tell
 * those apart, and neither could the page.
 *
 * Putting the rule in one tested function is the mechanism: a ninth tile added
 * to either list gets the behaviour by construction rather than by whoever adds
 * it remembering. The page keeps no runs ternaries at all.
 *
 * WHAT IT CANNOT DO. It cannot make `buildWorkspaceKpis` honest — that helper
 * takes rows and returns numbers, and zero rows are zero either way. So nothing
 * here calls it on an unreadable read; the notice is returned instead, and the
 * numbers are never computed.
 */

import { RUN_READ_CAP } from "@/lib/dashboard/chart-reads";
import type { ChartReadOutcome, DashboardRunRow } from "@/lib/dashboard/insights";
import { medianOverallScore, reportsGenerated } from "@/lib/dashboard/insights";
import { formatTimeToFirstResult, type WorkspaceKpis } from "@/lib/metrics/workspace-kpis";

export type DashboardTile = {
  label: string;
  value: string;
  detail: string;
};

export type DashboardTone = "good" | "neutral" | "attention";

export type DashboardInsightTile = DashboardTile & { tone: DashboardTone };

/**
 * What a tile says in place of a number, when the read behind it cannot support
 * one. The wording matches the charts' blocked notes deliberately: a planner who
 * meets "could not be read" on the figure and a different phrase on the tile
 * above it has been shown two problems where there is one.
 */
export type RunReadNotice = { value: string; detail: string; tone: DashboardTone };

export function runsReadNotice(
  read: ChartReadOutcome<DashboardRunRow>
): RunReadNotice | null {
  if (read.pending) {
    return {
      value: "Not switched on",
      detail:
        "This deployment has not applied the migration that records analysis runs, so there is nothing to count yet. Applying the pending migrations turns this on.",
      tone: "neutral",
    };
  }
  if (read.failed) {
    return {
      value: "Could not load",
      detail:
        "The analysis runs could not be read. This is a failed query, not an empty workspace — do not read it as zero. Reload, and tell whoever runs this deployment if it keeps happening.",
      tone: "attention",
    };
  }
  if (read.truncated) {
    return {
      value: "Too many to count",
      detail: `This workspace holds at least ${RUN_READ_CAP} analysis runs — more than this page reads in one go — so every total here would be short. Left blank rather than shown low.`,
      tone: "attention",
    };
  }
  return null;
}

function pct(value: number | null): string {
  return value === null ? "N/A" : `${value}%`;
}

function when(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/** The four tiles in the overview header. */
export function runKpiCards(
  read: ChartReadOutcome<DashboardRunRow>,
  kpis: WorkspaceKpis
): DashboardTile[] {
  const labels = [
    "Total runs",
    "Run completion rate",
    "Report generation rate",
    "Time to first result",
  ];

  const notice = runsReadNotice(read);
  if (notice) {
    return labels.map((label) => ({ label, value: notice.value, detail: notice.detail }));
  }

  return [
    {
      label: labels[0],
      value: `${kpis.totalRuns}`,
      detail: `${kpis.completedRuns} completed runs in this workspace`,
    },
    {
      label: labels[1],
      value: pct(kpis.runCompletionRate),
      detail: `${kpis.completedRuns}/${kpis.totalRuns} runs completed`,
    },
    {
      label: labels[2],
      value: pct(kpis.reportGenerationRate),
      detail: `${kpis.runsWithReports}/${kpis.totalRuns} runs exported`,
    },
    {
      label: labels[3],
      value: formatTimeToFirstResult(kpis.timeToFirstResultHours),
      detail: `First run at ${when(kpis.firstRunAt)}`,
    },
  ];
}

/**
 * The four tiles above the Insights figures. The fourth — "Waiting on you" —
 * comes from the operations summary, NOT from the runs read, so it keeps its
 * number when the runs read fails. Mixing them would hide a working figure
 * behind an unrelated failure.
 */
export function runInsightTiles(
  read: ChartReadOutcome<DashboardRunRow>,
  kpis: WorkspaceKpis,
  queueDepth: number
): DashboardInsightTile[] {
  const labels = ["Analysis runs", "Reports generated", "Median composite"];
  const notice = runsReadNotice(read);

  const runTiles: DashboardInsightTile[] = notice
    ? labels.map((label) => ({
        label,
        value: notice.value,
        detail: notice.detail,
        tone: notice.tone,
      }))
    : [
        {
          label: labels[0],
          value: `${kpis.totalRuns}`,
          detail: `${kpis.completedRuns} completed`,
          tone: kpis.totalRuns > 0 ? "good" : "neutral",
        },
        {
          label: labels[1],
          value: `${reportsGenerated(read.rows)}`,
          detail: `${kpis.runsWithReports}/${kpis.totalRuns} runs exported`,
          tone: "neutral",
        },
        {
          label: labels[2],
          value: medianOverallScore(read.rows) === null ? "Not scored" : `${medianOverallScore(read.rows)}`,
          // Screening-grade framing travels with the number, exactly as it does
          // on the run itself. A median composite on a dashboard is still not a
          // forecast.
          detail: "Screening-grade. Not comparable across study areas.",
          tone: "neutral",
        },
      ];

  return [
    ...runTiles,
    {
      label: "Waiting on you",
      value: `${queueDepth}`,
      detail: "Things waiting on you across the workspace",
      tone: queueDepth > 0 ? "attention" : "good",
    },
  ];
}

/**
 * Is this workspace KNOWN to be empty of analysis runs?
 *
 * `false` when the read failed — which is the whole point. The page uses the
 * emptiness verdict to suppress its quick actions and to print "Your workspace
 * is ready and empty", and a failed read must not produce either. Unknown is
 * not empty.
 */
export function runsAreKnownEmpty(read: ChartReadOutcome<DashboardRunRow>): boolean {
  return runsReadNotice(read) === null && read.rows.length === 0;
}
