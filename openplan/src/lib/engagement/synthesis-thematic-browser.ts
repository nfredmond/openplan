import { z } from "zod";
import { synthesisReviewGroupSchema, synthesisReviewMachineOriginSchema, verifySynthesisReviewContent } from "./synthesis-review";
import type { SynthesisSourceSnapshot } from "./synthesis-sources";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), natural = z.number().int().nonnegative().safe();
const date = z.string().datetime({ offset: true });
const scopeFields = { campaignId: id, workspaceId: id, sourceId: id, sourceSha256: hash };
export const thematicBrowserScopeSchema = z.object(scopeFields).strict();
export type ThematicBrowserScope = z.infer<typeof thematicBrowserScopeSchema>;
const cursor = z.object({ createdAt: date, id }).strict();
export const thematicRequestPageSchema = z.object({ schemaVersion: z.literal(1), ...scopeFields, pageSize: z.literal(25),
  entries: z.array(z.object({ requestId: id, createdAt: date, actorId: id, parentRequestId: id, cancelled: z.boolean() }).strict()).max(25),
  nextCursor: cursor.nullable(),
}).strict();
export type ThematicRequestPage = z.infer<typeof thematicRequestPageSchema>;
export const thematicPreviewSchema = z.object({ ...scopeFields, requestId: id,
  status: z.enum(["inputs_not_sealed", "not_prepared", "staging", "incomplete", "proposal_complete"]),
  selectionSequence: natural.nullable(), cancelled: z.boolean(), origin: synthesisReviewMachineOriginSchema.nullable(),
}).strict();
export type ThematicPreview = z.infer<typeof thematicPreviewSchema>;
const sourceId = z.string().regex(/^(item|answer):[a-f0-9-]{36}$/);
const citation = z.object({ noteId: natural, quote: z.string() }).strict();
const member = z.object({ sourceId, rationale: z.string(), citations: z.array(citation) }).strict();
export const thematicProposalDisplaySchema = z.object({ schemaVersion: z.literal(1), status: z.literal("machine_unreviewed"),
  sourceId: id, sourceSha256: hash, inputManifestSha256: hash, taskSha256: hash, outputSha256: hash,
  title: z.string(), notes: z.string(), groups: z.array(synthesisReviewGroupSchema.extend({ members: z.array(member) }).strict()),
  unassigned: z.array(z.object({ sourceId, reason: z.string(), citations: z.array(citation) }).strict()),
  assignedSourceCount: natural, overlappingSourceCount: natural, unassignedSourceIds: z.array(sourceId),
  contextEvidence: z.array(z.object({ sourceId, contextRequestId: id, selectionSequence: natural,
    historyManifestSha256: hash, finalCaptureSha256: hash, finalResultSha256: hash,
    notes: z.array(z.object({ id: natural, text: z.string() }).strict()), uncertainties: z.array(z.string()),
  }).strict()), thematicUncertainties: z.array(z.string()),
}).strict();
export type ThematicProposalDisplay = z.infer<typeof thematicProposalDisplaySchema>;
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
export function assertThematicBrowserScope(value: ThematicBrowserScope, scope: ThematicBrowserScope) {
  if (Object.keys(scopeFields).some(key => value[key as keyof ThematicBrowserScope] !== scope[key as keyof ThematicBrowserScope])) {
    throw new Error("Thematic history belongs to another source or workspace");
  }
}

/** Check transport identity and original text before display. Only the server's
 * authenticated replay establishes custody; hashes alone do not prove authorship
 * or the semantic quality of machine content.
 */
export async function inspectThematicPreview(raw: unknown, scope: ThematicBrowserScope, requestId: string, snapshot: SynthesisSourceSnapshot) {
  const preview = thematicPreviewSchema.parse(raw);
  assertThematicBrowserScope(preview, scope);
  if (preview.requestId !== requestId || (preview.status === "proposal_complete") !== Boolean(preview.origin)) throw new Error("Thematic preview status or request differs");
  if (!preview.origin) return { preview, proposal: null };
  const origin = preview.origin, reference = origin.reference;
  if (reference.requestId !== requestId || reference.selectionSequence !== preview.selectionSequence
    || await digest(origin.proposalText) !== reference.proposalSha256 || await digest(origin.historyText) !== reference.historyManifestSha256) {
    throw new Error("Original thematic preview bytes differ");
  }
  const history = z.object({ purpose: z.literal("private_synthesis_thematic_history"), campaignId: id, workspaceId: id,
    requestId: id, throughSequence: natural, status: z.literal("proposal_complete"),
    entries: z.array(z.object({ captureSha256: hash.nullable() }).passthrough()).min(1),
  }).passthrough().parse(JSON.parse(origin.historyText));
  if (history.campaignId !== scope.campaignId || history.workspaceId !== scope.workspaceId || history.requestId !== requestId
    || history.throughSequence !== reference.selectionSequence || history.entries.at(-1)?.captureSha256 !== reference.finalCaptureSha256) {
    throw new Error("Thematic preview history differs from the selected original");
  }
  const proposal = thematicProposalDisplaySchema.parse(JSON.parse(origin.proposalText));
  verifySynthesisReviewContent({ schemaVersion: 1, status: "staff_draft", sourceId: proposal.sourceId, sourceSha256: proposal.sourceSha256,
    title: proposal.title, notes: proposal.notes,
    groups: proposal.groups.map(({ id, label, summary, sentiment, sourceIds }) => ({ id, label, summary, sentiment, sourceIds })),
    assignedSourceCount: proposal.assignedSourceCount, overlappingSourceCount: proposal.overlappingSourceCount,
    unassignedSourceIds: proposal.unassignedSourceIds,
  }, snapshot, scope.sourceSha256);
  if (proposal.sourceId !== scope.sourceId) throw new Error("Thematic proposal source differs");
  return { preview, proposal };
}
