export type ModelRecoveryStatus =
  | { state: "unavailable" }
  | {
      state: "historical_unassessed" | "new_run";
      relaunchCustody?: "unstarted" | "retained" | "unassessed" | "unavailable";
      enrolledAt: string;
      observedStarts: number;
      lastStartObservedAt: string | null;
    };

/** A historical execution record cannot establish what a worker is doing now. */
export function modelRecoveryNotice(recovery: ModelRecoveryStatus | undefined): string | null {
  if (!recovery || recovery.state === "new_run") return null;
  if (recovery.state === "unavailable") {
    return "Recovery records could not be read. The saved run status does not confirm current execution. Relaunch remains unavailable until these records can be checked.";
  }
  return "This run predates execution tracking and needs reconciliation. Its saved status and results are preserved. They do not confirm that a worker is running now. Do not restart the computation until its database records, worker journal and output files have been reconciled.";
}

export function modelRecoveryNeedsReview(recovery: ModelRecoveryStatus | undefined): boolean {
  return recovery?.state === "historical_unassessed" || recovery?.state === "unavailable";
}

/** Enrollment describes history; only a separate custody read can offer a reset.
 * The launch route repeats this check because page data can become stale.
 */
export function modelRelaunchNotice(recovery: ModelRecoveryStatus | undefined): string | null {
  if (recovery?.state === "new_run" && recovery.relaunchCustody === "unstarted") return null;
  if (recovery?.state === "historical_unassessed" ||
      (recovery?.state === "new_run" && recovery.relaunchCustody === "unassessed")) {
    return "Relaunch is unavailable while this run's execution records need reconciliation. Existing results are preserved.";
  }
  if (recovery?.state === "new_run" && recovery.relaunchCustody === "retained") {
    return "This run has retained execution records. Relaunch is unavailable. Review execution recovery for its saved state and decisions.";
  }
  return "Relaunch is unavailable because this run's execution records could not be verified. Refresh the page to check again.";
}
