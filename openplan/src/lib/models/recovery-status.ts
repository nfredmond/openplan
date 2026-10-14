/** An owner's recorded keep-or-close choice. It changes no run data and authorizes no restart. */
export type HistoricalRunDecisionRecord = {
  requestId: string;
  outcome: "kept_as_record" | "closed_for_fresh_run";
  actorId: string;
  reason: string;
  recordedAt: string;
};

export type ModelRecoveryStatus =
  | { state: "unavailable" }
  | {
      state: "historical_unassessed" | "new_run";
      relaunchCustody?: "unstarted" | "retained" | "unassessed" | "unavailable";
      enrolledAt: string;
      observedStarts: number;
      lastStartObservedAt: string | null;
      historicalDecision?: HistoricalRunDecisionRecord | null;
    };

/** A historical execution record cannot establish what a worker is doing now. */
export function modelRecoveryNotice(recovery: ModelRecoveryStatus | undefined): string | null {
  if (!recovery || recovery.state === "new_run") return null;
  if (recovery.state === "unavailable") {
    return "Recovery records could not be read. The saved run status does not confirm current execution. Relaunch remains unavailable until these records can be checked.";
  }
  if (recovery.historicalDecision?.outcome === "kept_as_record") return "Kept as a record. Its saved results stay as they were.";
  if (recovery.historicalDecision?.outcome === "closed_for_fresh_run") return "Closed. Its saved results stay as they were. Start a new run to run it again.";
  return "Recorded before recovery tracking. Keep as a record, or close it to run again.";
}

/** A historical run waits for an owner's keep-or-close choice. */
export function historicalRunNeedsDecision(recovery: ModelRecoveryStatus | undefined): boolean {
  return recovery?.state === "historical_unassessed" && !recovery.historicalDecision;
}

/** True while a run must not be treated as live work: no polling, progress or reaping.
 * A keep-or-close decision does not change this; historical runs stay read-only.
 */
export function modelRecoveryNeedsReview(recovery: ModelRecoveryStatus | undefined): boolean {
  return recovery?.state === "historical_unassessed" || recovery?.state === "unavailable";
}

/** Enrollment describes history; only a separate custody read can offer a reset.
 * The launch route repeats this check because page data can become stale.
 */
export function modelRelaunchNotice(recovery: ModelRecoveryStatus | undefined): string | null {
  if (recovery?.state === "new_run" && recovery.relaunchCustody === "unstarted") return null;
  if (recovery?.state === "historical_unassessed") return "This run cannot be relaunched. Start a new run instead.";
  if (recovery?.state === "new_run" && recovery.relaunchCustody === "unassessed") {
    return "Relaunch is unavailable while this run's execution records need reconciliation. Existing results are preserved.";
  }
  if (recovery?.state === "new_run" && recovery.relaunchCustody === "retained") {
    return "This run has retained execution records. Relaunch is unavailable. Review execution recovery for its saved state and decisions.";
  }
  return "Relaunch is unavailable because this run's execution records could not be verified. Refresh the page to check again.";
}
