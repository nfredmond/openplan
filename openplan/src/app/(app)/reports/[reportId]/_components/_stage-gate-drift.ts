import type { ProjectStageGateSnapshot, ProjectStageGateSummary } from "@/lib/stage-gates/summary";
import type { DriftItem } from "./_types";

/** Keep an unavailable binding or decision log distinct from an absent board. */
export function describeStageGateReadFailure(
  snapshot: ProjectStageGateSnapshot | null,
  projectId: string | null,
  bindingProblem: string | null,
  current: ProjectStageGateSummary | null,
): string | null {
  return snapshot && projectId && bindingProblem
    ? bindingProblem
    : current && !current.decisionsRead.readable
      ? current.decisionsRead.reason
      : null;
}

/** Compare the retained gates with a readable live board. Unknown is not zero. */
export function buildStageGateDriftItem(
  snapshot: ProjectStageGateSnapshot | null,
  current: ProjectStageGateSummary | null,
  readFailed: boolean,
): DriftItem | null {
  if (!snapshot || !current || readFailed) return null;

  const snapshotBlockedGateId = snapshot.blockedGate?.gateId ?? null;
  const currentBlockedGateId = current.blockedGate?.gateId ?? null;
  const snapshotNextGateId = snapshot.nextGate?.gateId ?? null;
  const currentNextGateId = current.nextGate?.gateId ?? null;
  const countsChanged =
    snapshot.passCount !== current.passCount ||
    snapshot.holdCount !== current.holdCount ||
    snapshot.notStartedCount !== current.notStartedCount;
  const gatesChanged =
    snapshotBlockedGateId !== currentBlockedGateId ||
    snapshotNextGateId !== currentNextGateId;

  return {
    key: "stage-gates",
    label: "Stage gates",
    status: gatesChanged
      ? "gate changed"
      : countsChanged
        ? "count changed"
        : "unchanged",
    detail: gatesChanged
      ? `Blocked ${snapshotBlockedGateId ?? "none"} -> ${currentBlockedGateId ?? "none"}. Next ${snapshotNextGateId ?? "complete"} -> ${currentNextGateId ?? "complete"}.`
      : countsChanged
        // This count describes decisions without a recorded verdict.
        ? `Snapshot ${snapshot.passCount} pass / ${snapshot.holdCount} hold / ${snapshot.notStartedCount} with no decision recorded. Live ${current.passCount} pass / ${current.holdCount} hold / ${current.notStartedCount} with no decision recorded.`
        : "Review counts and next steps still match the saved report snapshot.",
  };
}
