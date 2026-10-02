import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSynthesisThematicHistory } from "./synthesis-thematic-history-server";
import { verifySynthesisReviewContent, type SynthesisReviewContent, type SynthesisReviewIntent } from "./synthesis-review";
import type { loadSynthesisSource } from "./synthesis-sources-server";

// Older category-only readers need no private original-capture access. An import
// requires this capability explicitly and still uses authenticated staff gates.
export type SynthesisReviewEvidenceService = Pick<SupabaseClient, "rpc"> & Partial<Pick<SupabaseClient, "from">>;
type Import = Extract<SynthesisReviewIntent, { operation: "import_thematic" }>;
type Source = Awaited<ReturnType<typeof loadSynthesisSource>>;
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Reconstruct the chosen original proposal on both writes and historical review
 * reads. Compact client references cannot stand in for the original captures.
 * Cancellation or requester departure does not invalidate retained evidence.
 */
export async function importSynthesisThematicReview(client: Pick<SupabaseClient, "rpc">,
  service: SynthesisReviewEvidenceService | undefined, campaignId: string,
  parent: SynthesisReviewContent, intent: Import, source: Source) {
  verifySynthesisReviewContent(parent, source.snapshot, source.snapshotSha256);
  if (!service?.from) throw new Error("Original thematic evidence reader is required");
  const history = await loadSynthesisThematicHistory(client, { rpc: service.rpc.bind(service), from: service.from.bind(service) }, {
    campaignId, workspaceId: intent.workspaceId, requestId: intent.proposal.requestId,
    throughSequence: intent.proposal.selectionSequence,
  }, new AbortController().signal);
  const proposal = history.proposal, final = history.entries.at(-1);
  if (history.manifest.status !== "proposal_complete" || !proposal || history.interpretation !== "machine_unreviewed"
    || history.manifest.throughSequence !== intent.proposal.selectionSequence
    || history.sha256 !== intent.proposal.historyManifestSha256 || hash(history.canonical) !== history.sha256
    || proposal.sha256 !== intent.proposal.proposalSha256 || hash(proposal.canonical) !== proposal.sha256
    || final?.captureSha256 !== intent.proposal.finalCaptureSha256
    || proposal.content.sourceId !== source.requestId || proposal.content.sourceSha256 !== source.snapshotSha256) {
    throw new Error("Selected thematic proposal differs from original history");
  }
  // Keep the full original proposal, including citations and every earlier
  // uncertainty, in retained review content. Later corrections preserve it.
  // Staff draft status does not change the original machine interpretation.
  return verifySynthesisReviewContent({
    schemaVersion: 1, status: "staff_draft", sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    title: proposal.content.title, notes: proposal.content.notes,
    machineOrigin: { interpretation: "machine_unreviewed", reference: intent.proposal,
      proposalText: proposal.canonical, historyText: history.canonical },
    groups: proposal.content.groups.map(({ id, label, summary, sentiment, sourceIds }) => ({ id, label, summary, sentiment, sourceIds })),
    unassignedSourceIds: proposal.content.unassignedSourceIds, assignedSourceCount: proposal.content.assignedSourceCount,
    overlappingSourceCount: proposal.content.overlappingSourceCount,
  }, source.snapshot, source.snapshotSha256);
}
