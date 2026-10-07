import type { GuidedComparisonResult } from "@/lib/models/guided-comparison-results";
import type { BcaDocument } from "./schema";
import { newBcaFlow } from "./document";
export type BcaModelEvidence = {
  snapshotId: string;
  scenarioSetId: string;
  label: string;
  updatedAt: string;
  result: GuidedComparisonResult;
};
/** Copy one method's explicit daily VMT pair, retaining its original model identities. */
export function importBcaModelEvidence(
  doc: BcaDocument,
  evidence: BcaModelEvidence,
): BcaDocument {
  const metric = evidence.result.metrics.find((m) => m.key === "daily_vmt");
  if (
    !metric ||
    ![
      "vehicle-miles/day",
      "vehicle-miles per day",
      "vehicle_miles/day",
    ].includes(metric.unit) ||
    !Number.isFinite(metric.baseline) ||
    !Number.isFinite(metric.build) ||
    metric.baseline < 0 ||
    metric.build < 0
  )
    throw new Error(
      "This comparison does not provide a supported, finite daily vehicle-mile pair.",
    );
  const id = `model-${evidence.snapshotId}-${evidence.result.method}`;
  if (doc.evidence.some((s) => s.id === id))
    throw new Error(
      "This method and comparison are already in the source register. Review the existing stream.",
    );
  if (
    doc.evidence.some(
      (source) =>
        source.id.startsWith("model-") && source.status === "model-screening",
    )
  )
    throw new Error(
      "This analysis already contains a model comparison. Use a separate analysis version for competing model results; their effects must not be added.",
    );
  const source = {
    id,
    title: `${evidence.label}: ${evidence.result.methodLabel}`,
    reference: `/scenarios/${evidence.scenarioSetId}`,
    locator: `Snapshot ${evidence.snapshotId}, read from saved comparison updated ${evidence.updatedAt}; No Build run ${evidence.result.baseline.runId}; Build run ${evidence.result.build.runId}`,
    observedYear: null,
    status: "model-screening" as const,
    method: `Saved daily VMT pair (${metric.unit}). No Build ${metric.baseline}; Build ${metric.build}. No averaging with the other demand method.`,
    limitation: `No Build claim: ${evidence.result.baseline.claimStatus ?? "unassessed"}. ${evidence.result.baseline.statusReason ?? ""} Build claim: ${evidence.result.build.claimStatus ?? "unassessed"}. ${evidence.result.build.statusReason ?? ""} Confirm common geography, network, population, forecast year and daily period. This copy does not prove scientific validity; recheck source changes.`,
    owner: "",
    dueDate: "",
  };
  const flow = {
    ...newBcaFlow(doc, "benefit", `${id}-voc`),
    label: `${evidence.result.methodLabel} operating-cost difference`,
    category: "vehicle-operating" as const,
    unit: "vehicle-mile" as const,
    noBuild: metric.baseline,
    build: metric.build,
    annualization: null,
    unitValue: null,
    sourceIds: [id],
    overlapGroup: "travel-demand-method",
    rationale:
      "Daily VMT copied from one saved model comparison. Supply a supported annualization, valuation and forecast schedule. A competing method is an alternative case, not an additive benefit.",
  };
  return {
    ...doc,
    evidence: [...doc.evidence, source],
    flows: [...doc.flows, flow],
  };
}
