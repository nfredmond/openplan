import { createHash } from "node:crypto";
import type { SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";
export const sourceScope = { requestId: "d0000000-0000-4000-8000-000000000001", campaignId: "c0000000-0000-4000-8000-000000000001", workspaceId: "a0000000-0000-4000-8000-000000000001" };
export const sourceActor = "a0000000-0000-4000-8000-000000000002";
export const sourceCategory = "a0000000-0000-4000-8000-000000000003";
const version = "a0000000-0000-4000-8000-000000000004";
const session = "a0000000-0000-4000-8000-000000000005";
const question = "a0000000-0000-4000-8000-000000000006";
export const sourceDate = "2026-01-02T12:00:00.000Z";
export const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex");
export function makeSourceSnapshot(n = 301): SynthesisSourceSnapshot {
  const definitionText = JSON.stringify({ schema: 1, campaign: { title: "SYNTHETIC original" }, categories: [{ id: sourceCategory, label: "SYNTHETIC retained category" }], questions: [{ id: question, category_id: sourceCategory, prompt: "SYNTHETIC original question" }], layers: [] });
  return {
    ...sourceScope, schemaVersion: 1, scope: "internal", capturedAt: sourceDate,
    selection: { statuses: ["approved"], includeItems: true, includeSurveys: true, categoryIds: [], from: null, to: null },
    campaign: { id: sourceScope.campaignId, title: "SYNTHETIC retained context", summary: null, projectId: null, configurationVersionId: version },
    counts: { items: n, sessions: 1, answers: 1, campaignItems: n, campaignSessions: 1, campaignAnswers: 1 },
    items: Array.from({ length: n }, (_, i) => ({
      id: `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, campaign_id: sourceScope.campaignId,
      body: i === n - 1 ? "SYNTHETIC long concern é ".repeat(50) + "FINAL SOURCE TAIL" : `SYNTHETIC comment ${i}`,
      title: null, category_id: sourceCategory, configuration_version_id: version, status: "approved" as const,
      created_at: sourceDate, updated_at: sourceDate, parent_item_id: null,
      geometry: { type: "LineString", coordinates: [[12.5, -8.25], [12.75, -8.5]] },
    })),
    sessions: [{ id: session, campaign_id: sourceScope.campaignId, configuration_version_id: version, status: "approved", created_at: sourceDate, updated_at: sourceDate }],
    answers: [{ id: "a0000000-0000-4000-8000-000000000007", session_id: session, campaign_id: sourceScope.campaignId, question_id: question,
      question_type: "free_text", question_prompt_snapshot: "SYNTHETIC original question", answer_text: "SYNTHETIC distinct survey concern", answer_json: { text: "SYNTHETIC distinct survey concern", missing: null } }],
    definitions: [{ id: version, campaignId: sourceScope.campaignId, sha256: sourceHash(definitionText), definitionText }],
  };
}
export function savedSource(snapshot = makeSourceSnapshot()) {
  const snapshotText = JSON.stringify(snapshot, null, 2);
  return { ...sourceScope, snapshotText, snapshotSha256: sourceHash(snapshotText), createdAt: sourceDate };
}
export function sourceReceipt(replayed = false) {
  const snapshot = makeSourceSnapshot();
  return { ...sourceScope, snapshotSha256: savedSource(snapshot).snapshotSha256, createdAt: sourceDate, counts: snapshot.counts, replayed };
}
