/**
 * What the safety action plan section of a report carries beside its frozen
 * draft: the project's engagement summary, its saved benefit-cost analysis,
 * and the ranked high-injury network drawn as a figure.
 *
 * The engagement and benefit-cost blocks are built by the same functions as
 * the SS4A application's appendices D and E, so the report and the
 * application say the same thing about the same records. A record that does
 * not exist prints "Missing"; a read that failed prints "Could not be read".
 *
 * These blocks are rendered only. They are not part of the frozen Safety
 * snapshot, whose schema and hash an SS4A seed relies on.
 */

import type { CorridorGeojson } from "@/lib/models/run-launch";
import {
  bcaEvidenceAppendix,
  engagementEvidenceAppendix,
  type EvidenceAppendix,
  type ProjectBcaRead,
  type ProjectEngagementRead,
} from "@/lib/grants/evidence-appendices";
import { loadProjectBcaRead, loadProjectEngagementRead, type EvidenceQueryClient } from "@/lib/grants/evidence-appendix-reads";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";
import { renderSafetyStreetContextSvg } from "@/lib/safety/street-context-svg";
import type { SafetyActionPlanEngagementInput } from "./safety-action-plan";

export type SafetyPlanSupportReads = { engagement: ProjectEngagementRead; bca: ProjectBcaRead };

export type SafetyPlanNetworkMap =
  | { kind: "drawn"; svg: string; segmentCount: number }
  | { kind: "not_drawn"; reason: string };

export type SafetyPlanSupport = {
  engagement: EvidenceAppendix<"engagement">;
  bca: EvidenceAppendix<"bca">;
  networkMap: SafetyPlanNetworkMap | null;
};

const TITLES = { engagement: "Engagement summary", bca: "Benefit-cost summary" } as const;

/** Read the project's engagement and benefit-cost records. A thrown read becomes "unreadable", never absent. */
export async function loadSafetyPlanSupportReads(
  client: unknown,
  input: { projectId: string; workspaceId: string }
): Promise<SafetyPlanSupportReads> {
  const query = client as EvidenceQueryClient;
  const [engagement, bca] = await Promise.all([
    loadProjectEngagementRead(query, input.projectId, input.workspaceId).catch(
      (): ProjectEngagementRead => ({ status: "unreadable", reason: "Engagement campaigns could not be read. That is a failed read, not an absence of engagement." })
    ),
    loadProjectBcaRead(query, input.projectId).catch(
      (): ProjectBcaRead => ({ status: "unreadable", reason: "Saved benefit-cost analyses could not be read. That is a failed read, not an absence of analysis." })
    ),
  ]);
  return { engagement, bca };
}

/** The engagement component's input: approved comments or an approved staff review on the lead campaign. */
export function safetyPlanEngagementInput(read: ProjectEngagementRead): SafetyActionPlanEngagementInput | null {
  if (read.status !== "ready") return null;
  return {
    campaignTitle: read.evidence.leadCampaign.title,
    approvedComments: read.comments.status === "ready" ? read.comments.approved : null,
    approvedStaffReview: read.staffReview.status === "approved",
  };
}

/**
 * The ranked network as a figure, numbered by rank. Every ranked segment is
 * drawn, so the figure, the table and the stated count agree.
 */
export function buildSafetyPlanNetworkMap(input: {
  network: HighInjuryNetwork | undefined;
  roads: readonly SafetyRoadContextFeature[] | null | undefined;
  projectGeometry: CorridorGeojson | null;
}): SafetyPlanNetworkMap | null {
  const { network } = input;
  if (!network || network.status !== "computed") return null;
  if (network.segments.length === 0) return { kind: "not_drawn", reason: "No segment is ranked, so there is nothing to map." };
  const svg = renderSafetyStreetContextSvg({
    roads: input.roads ?? [],
    crashLocations: [],
    projectGeometry: input.projectGeometry,
    highlights: network.segments.map((segment) => ({ rank: segment.rank, geometry: segment.geometry })),
    ariaLabel: "Ranked high-injury network segments, numbered by rank",
  });
  return svg
    ? { kind: "drawn", svg, segmentCount: network.segments.length }
    : { kind: "not_drawn", reason: "The ranked segments carry no drawable coordinates." };
}

export function buildSafetyPlanSupport(input: {
  reads: SafetyPlanSupportReads;
  projectId: string;
  projectName: string | null;
  networkMap: SafetyPlanNetworkMap | null;
}): SafetyPlanSupport {
  return {
    engagement: engagementEvidenceAppendix({ key: "engagement", letter: "", title: TITLES.engagement }, input.reads.engagement, input.projectName),
    bca: bcaEvidenceAppendix({ key: "bca", letter: "", title: TITLES.bca }, input.reads.bca, input.projectId),
    networkMap: input.networkMap,
  };
}
