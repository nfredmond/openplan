export type ModelRecoveryStatus =
  | { state: "unavailable" }
  | {
      state: "historical_unassessed" | "new_run";
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
