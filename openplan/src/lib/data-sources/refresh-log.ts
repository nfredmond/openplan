/**
 * Honest display for `data_refresh_jobs` rows.
 *
 * Nothing in OpenPlan executes these jobs — there is no worker, no cron, no
 * scheduler. Rows are inserted by operators (via /api/data-hub/records) to
 * document refreshes they performed or plan to perform. A raw "Queued" badge
 * would promise a runner that does not exist, so every status renders as a
 * record of operator-reported state, never as orchestrated work.
 *
 * Status values mirror the `data_refresh_jobs` CHECK constraint
 * (20260313000014_data_hub_module.sql): queued | running | succeeded |
 * failed | cancelled. Refresh modes mirror the `refresh_mode` CHECK:
 * manual | scheduled | pipeline | analysis_runtime.
 */

export type RefreshJobStatusTone = "info" | "success" | "warning" | "danger" | "neutral";

export type RefreshJobStatusDescriptor = {
  label: string;
  tone: RefreshJobStatusTone;
  caveat: string;
};

const REFRESH_MODE_NOTES: Record<string, string> = {
  manual: "Logged as a manual refresh an operator performs directly.",
  scheduled:
    "Logged as scheduled, but OpenPlan runs no scheduler — the cadence is documentation until an operator performs the refresh.",
  pipeline: "Logged as pipeline work executed outside OpenPlan.",
  analysis_runtime: "Logged from an analysis flow that refreshed this source while it ran.",
};

export function describeRefreshJobStatus(
  status: string | null | undefined,
  refreshMode?: string | null
): RefreshJobStatusDescriptor {
  const normalizedStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
  const normalizedMode = typeof refreshMode === "string" ? refreshMode.trim().toLowerCase() : "";
  const modeNote = REFRESH_MODE_NOTES[normalizedMode] ?? null;

  let base: RefreshJobStatusDescriptor;
  switch (normalizedStatus) {
    case "queued":
      base = {
        label: "Recorded — no runner attached",
        tone: "neutral",
        caveat:
          "No background runner executes queued refresh jobs; this row documents a refresh an operator plans to perform.",
      };
      break;
    case "running":
      base = {
        label: "Recorded as in progress",
        tone: "info",
        caveat: "Progress is operator-reported; OpenPlan does not orchestrate or monitor this job.",
      };
      break;
    case "succeeded":
      base = {
        label: "Recorded as completed",
        tone: "success",
        caveat: "Completion was reported by whoever performed the refresh; OpenPlan did not execute it.",
      };
      break;
    case "failed":
      base = {
        label: "Recorded as failed",
        tone: "danger",
        caveat:
          "The failure was reported by whoever attempted the refresh; review the source before relying on dependent outputs.",
      };
      break;
    case "cancelled":
      base = {
        label: "Recorded as cancelled",
        tone: "warning",
        caveat:
          "The cancellation was reported by whoever managed the refresh; the source did not update through this job.",
      };
      break;
    default:
      base = {
        label: "Recorded — status unknown",
        tone: "neutral",
        caveat: "This row carries an unrecognized status; treat it as documentation, not orchestrated work.",
      };
      break;
  }

  return modeNote ? { ...base, caveat: `${base.caveat} ${modeNote}` } : base;
}
