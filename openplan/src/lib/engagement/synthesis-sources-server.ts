import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { synthesisSourceSnapshotSchema, type SynthesisSourceSnapshot } from "./synthesis-sources";

const savedSourceSchema = z.object({
  requestId: z.string().uuid(), campaignId: z.string().uuid(), workspaceId: z.string().uuid(),
  snapshotText: z.string(), snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime({ offset: true }),
}).strict();
const definitionSchema = z.object({
  schema: z.literal(1), campaign: z.record(z.string(), z.unknown()),
  categories: z.array(z.object({ id: z.string().uuid(), label: z.string() }).passthrough()),
  questions: z.array(z.object({ id: z.string().uuid(), category_id: z.string().uuid().nullable().optional() }).passthrough()),
  layers: z.array(z.unknown()),
}).passthrough();
export type SynthesisSourceScope = { requestId: string; campaignId: string; workspaceId: string };
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const unique = (rows: Array<{ id: string }>) => new Set(rows.map(row => row.id)).size === rows.length;

/** Check exact saved bytes and every reference before any source text reaches a draft or model. */
export function verifySynthesisSource(raw: unknown, expected: SynthesisSourceScope) {
  const saved = savedSourceSchema.parse(raw);
  if (saved.requestId !== expected.requestId || saved.campaignId !== expected.campaignId || saved.workspaceId !== expected.workspaceId) throw new Error("Saved synthesis source scope differs");
  if (sha256(saved.snapshotText) !== saved.snapshotSha256) throw new Error("Saved synthesis source checksum differs");
  const snapshot = synthesisSourceSnapshotSchema.parse(JSON.parse(saved.snapshotText));
  if (snapshot.requestId !== expected.requestId || snapshot.campaignId !== expected.campaignId || snapshot.workspaceId !== expected.workspaceId || snapshot.campaign.id !== expected.campaignId) throw new Error("Retained synthesis source scope differs");
  verifyContents(snapshot);
  const definitions = snapshot.definitions.map(entry => {
    if (entry.campaignId !== expected.campaignId || sha256(entry.definitionText) !== entry.sha256) throw new Error("Historical definition checksum or scope differs");
    const definition = definitionSchema.parse(JSON.parse(entry.definitionText));
    if (!unique(definition.categories) || !unique(definition.questions)) throw new Error("Duplicate historical definition identifiers");
    return { ...entry, definition };
  });
  const definitionIds = new Set(definitions.map(entry => entry.id));
  const referenced = [snapshot.campaign.configurationVersionId, ...snapshot.items.map(row => row.configuration_version_id), ...snapshot.sessions.map(row => row.configuration_version_id)];
  if (referenced.some(id => id !== null && !definitionIds.has(id))) throw new Error("Retained synthesis source definition is missing");
  if (snapshot.selection.categoryIds.length) {
    const selected = new Set(snapshot.selection.categoryIds.map(id => id.toLowerCase()));
    if (snapshot.items.some(row => !row.category_id || !selected.has(row.category_id))) throw new Error("Retained item category falls outside selection");
    const sessionById = new Map(snapshot.sessions.map(row => [row.id, row]));
    const definitionById = new Map(definitions.map(entry => [entry.id, entry.definition]));
    for (const answer of snapshot.answers) {
      const version = sessionById.get(answer.session_id)?.configuration_version_id;
      const question = version ? definitionById.get(version)?.questions.find(row => row.id === answer.question_id) : undefined;
      if (!question?.category_id || !selected.has(question.category_id)) throw new Error("Retained answer category falls outside historical selection");
    }
  }
  return { ...saved, snapshot, definitions };
}

/** Counts describe the retained selection, while campaign totals disclose excluded records. */
function verifyContents(snapshot: SynthesisSourceSnapshot) {
  const { counts, selection, items, sessions, answers, definitions } = snapshot;
  if (counts.items !== items.length || counts.sessions !== sessions.length || counts.answers !== answers.length
    || counts.campaignItems < counts.items || counts.campaignSessions < counts.sessions || counts.campaignAnswers < counts.answers) throw new Error("Retained synthesis source counts differ");
  if (![items, sessions, answers, definitions].every(unique)) throw new Error("Duplicate retained synthesis source identifiers");
  if ((!selection.includeItems && items.length) || (!selection.includeSurveys && (sessions.length || answers.length))) throw new Error("Retained synthesis source selection differs");
  const sessionIds = new Set(sessions.map(row => row.id));
  for (const row of [...items, ...sessions, ...answers]) {
    if (row.campaign_id !== snapshot.campaignId) throw new Error("Retained contribution belongs to another campaign");
    if (["metadata_json", "respondent_fingerprint", "submitted_by", "request_id", "request_sha256", "created_by"].some(key => key in row)) throw new Error("Unselected contact or request metadata in synthesis source");
  }
  for (const row of [...items, ...sessions]) {
    if (!selection.statuses.includes(row.status) || (selection.from && Date.parse(row.created_at) < Date.parse(selection.from)) || (selection.to && Date.parse(row.created_at) >= Date.parse(selection.to))) throw new Error("Retained contribution falls outside selection");
  }
  if (answers.some(row => !sessionIds.has(row.session_id))) throw new Error("Retained answer session is missing");
}

/** A failed or unreadable saved-source query stays unavailable; it is never an empty source set. */
export async function loadSynthesisSource(client: Pick<SupabaseClient, "rpc">, scope: SynthesisSourceScope) {
  const result = await client.rpc("read_engagement_synthesis_sources", { p_campaign: scope.campaignId, p_request: scope.requestId });
  if (result.error) throw new Error("Saved synthesis source is unavailable");
  return verifySynthesisSource(result.data, scope);
}
