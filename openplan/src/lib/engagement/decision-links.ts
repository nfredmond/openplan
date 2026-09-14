import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { closeLoopEntrySchema } from "./close-loop";

const id = z.string().uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const words = z.string().nullable();
const operation = z.enum(["link", "refresh", "withdraw"]);
const reason = z.string().max(4000).refine(text => text.trim().length > 0 && [...text].length <= 2000 && !text.includes("\0"), "Record a reason of at most 2000 characters");
export const projectDecisionSchema = z.object({
  id, project_id: id, title: z.string(), rationale: z.string(),
  status: z.enum(["proposed", "approved", "rejected"]), impact_summary: words,
  decided_at: time.nullable(), created_by: id.nullable(), created_at: time, updated_at: time,
}).strict();
const response = closeLoopEntrySchema.passthrough();
const source = z.object({
  itemId: id, position: count, availability: z.enum(["available", "unavailable"]),
  configurationAvailability: z.enum(["available", "unavailable", "unknown"]),
  record: z.object({
    id, campaign_id: id, category_id: id.nullable(), title: words, body: z.string(),
    status: z.enum(["pending", "approved", "rejected", "flagged"]), source_type: z.string(),
    geometry: z.unknown(), latitude: z.number().nullable(), longitude: z.number().nullable(),
    parent_item_id: id.nullable(), configuration_version_id: id.nullable(), created_at: time, updated_at: time,
  }).strict().nullable(),
}).strict();
const contextSchema = z.object({
  schema: z.literal(1), visibility: z.literal("private"), sourceObservation: z.literal("current_at_link_preview"),
  campaign: z.object({ id, workspaceId: id, title: z.string() }).strict(),
  project: z.object({ id, workspaceId: id, name: z.string() }).strict(),
  relationship: z.object({ id, workspace_id: id, campaign_id: id, project_id: id, created_by: id.nullable(), created_at: time }).strict(),
  response,
  responseHistory: z.object({ id, revision: count.refine(value => value > 0),
    event: z.enum(["legacy_baseline", "created", "corrected", "published", "unpublished"]),
    actorId: id.nullable(), recordedAt: time, recordText: z.string(), recordSha256: sha }).strict(),
  decision: projectDecisionSchema, sourceCount: count, sources: source.array(), configurationCount: count,
  configurations: z.object({ id, campaignId: id, createdAt: time, definitionText: z.string(), definitionSha256: sha }).strict().array(),
}).strict();
export type DecisionLinkContext = z.infer<typeof contextSchema>;
export type DecisionLinkScope = { campaignId: string; workspaceId: string };
export type DecisionLinkAddress = DecisionLinkScope & { responseId: string; decisionId: string };

export const decisionLinkIntentSchema = z.object({
  requestId: id, responseId: id, decisionId: id, operation,
  predecessorId: id.nullable(), expectedContextSha256: sha.nullable(), reason,
}).strict().superRefine((intent, ctx) => {
  if ((intent.operation === "link") !== (intent.predecessorId === null)
    || (intent.operation === "withdraw") !== (intent.expectedContextSha256 === null)
    || intent.predecessorId === intent.requestId) {
    ctx.addIssue({ code: "custom", message: "Review the operation, previous link and exact source version" });
  }
});
export type DecisionLinkIntent = z.infer<typeof decisionLinkIntentSchema>;
const payloadSchema = z.object({
  campaignId: id, responseId: id, decisionId: id, operation, predecessorId: id.nullable(),
  expectedContextSha256: sha.nullable(), reason,
}).strict();
export const decisionLinkRowSchema = z.object({
  id, workspace_id: id, campaign_id: id, response_id: id, decision_id: id, project_id: id,
  predecessor_id: id.nullable(), operation, actor_id: id, reason,
  payload_json: payloadSchema, payload_text: z.string(), payload_sha256: sha,
  context_text: z.string(), context_sha256: sha, created_at: time,
}).strict();
export type DecisionLinkRow = z.infer<typeof decisionLinkRowSchema>;
export type VerifiedDecisionLink = DecisionLinkRow & { context: DecisionLinkContext };
const contextPacketSchema = z.object({ contextText: z.string(), contextSha256: sha }).strict();
export type DecisionContextPacket = z.infer<typeof contextPacketSchema>;
const receiptSchema = z.object({ link: decisionLinkRowSchema, replayed: z.boolean() }).strict();
export type DecisionLinkReceipt = z.infer<typeof receiptSchema>;
const currentSchema = z.object({
  linkId: id, sourceState: z.enum(["unchanged", "changed", "unavailable"]),
  currentContextSha256: sha.nullable(), unavailableReason: z.enum(["source_unavailable", "history_conflict"]).nullable(),
}).strict();
const snapshotSchema = z.object({
  schema: z.literal(1), campaignId: id, workspaceId: id,
  decisions: z.object({ projectName: z.string(), record: projectDecisionSchema }).strict().array(), decisionCount: count,
  entries: decisionLinkRowSchema.array(), entryCount: count, current: currentSchema.array(), currentCount: count,
}).strict();
export type DecisionLinkSnapshot = Omit<z.infer<typeof snapshotSchema>, "entries"> & { entries: VerifiedDecisionLink[] };
export type DecisionLinkSnapshotPacket = z.infer<typeof snapshotSchema>;

const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
const withoutClock = ({ updated_at: _clock, ...value }: Record<string, unknown>) => value;

/** Use the same exact-byte check in server loaders and browser receipt recovery. */
async function checkHash(text: string, expected: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const actual = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error("Decision evidence checksum differs");
}

/** Validate scope, original definitions and complete ordered references before showing a preview. */
export async function readDecisionContext(raw: unknown, scope: DecisionLinkAddress) {
  const packet = contextPacketSchema.parse(raw);
  await checkHash(packet.contextText, packet.contextSha256);
  const context = contextSchema.parse(JSON.parse(packet.contextText));
  const { campaign, project, relationship, response: entry, decision, responseHistory: history } = context;
  if (campaign.id !== scope.campaignId || campaign.workspaceId !== scope.workspaceId
    || project.workspaceId !== scope.workspaceId || decision.id !== scope.decisionId || decision.project_id !== project.id
    || entry.id !== scope.responseId || entry.campaign_id !== scope.campaignId
    || relationship.campaign_id !== scope.campaignId || relationship.workspace_id !== scope.workspaceId || relationship.project_id !== project.id) {
    throw new Error("Decision context scope differs");
  }
  await checkHash(history.recordText, history.recordSha256);
  const old = response.parse(JSON.parse(history.recordText));
  if (!same(withoutClock(old), withoutClock(entry))) throw new Error("Retained response differs");
  if (context.sourceCount !== context.sources.length || context.sourceCount !== entry.source_item_ids.length
    || context.configurationCount !== context.configurations.length) throw new Error("Decision source inventory is incomplete");
  const definitions = new Set<string>();
  for (const definition of context.configurations) {
    if (definition.campaignId !== scope.campaignId || definitions.has(definition.id)) throw new Error("Decision definition scope differs");
    await checkHash(definition.definitionText, definition.definitionSha256);
    if (!z.record(z.string(), z.unknown()).safeParse(JSON.parse(definition.definitionText)).success) throw new Error("Invalid retained definition");
    definitions.add(definition.id);
  }
  const used = new Set<string>();
  for (const [index, item] of context.sources.entries()) {
    if (item.itemId !== entry.source_item_ids[index] || item.position !== index + 1) throw new Error("Decision source order differs");
    if (item.availability === "unavailable") {
      if (item.record !== null || item.configurationAvailability !== "unavailable") throw new Error("Unavailable source has invented content");
      continue;
    }
    const record = item.record;
    if (!record || record.id !== item.itemId || record.campaign_id !== scope.campaignId || !("geometry" in record)) throw new Error("Decision source scope differs");
    const configuration = record.configuration_version_id;
    const expected = configuration === null ? "unknown" : definitions.has(configuration) ? "available" : "unavailable";
    if (item.configurationAvailability !== expected) throw new Error("Decision source configuration differs");
    if (configuration !== null && definitions.has(configuration)) used.add(configuration);
  }
  if (used.size !== definitions.size) throw new Error("Decision context has unrelated definitions");
  return { packet, context };
}

/** Verify a retained record independently of whether its current source still exists. */
export async function readDecisionLink(raw: unknown, scope: DecisionLinkScope): Promise<VerifiedDecisionLink> {
  const row = decisionLinkRowSchema.parse(raw);
  if (row.campaign_id !== scope.campaignId || row.workspace_id !== scope.workspaceId) throw new Error("Decision link scope differs");
  const payload = payloadSchema.parse(JSON.parse(row.payload_text));
  await checkHash(row.payload_text, row.payload_sha256);
  const intent = decisionLinkIntentSchema.parse({ requestId: row.id, responseId: row.response_id,
    decisionId: row.decision_id, operation: row.operation, predecessorId: row.predecessor_id,
    expectedContextSha256: payload.expectedContextSha256, reason: row.reason });
  if (!same(payload, row.payload_json) || !same(payload, decisionLinkPayload(scope, intent))) throw new Error("Decision link payload differs");
  const { context } = await readDecisionContext({ contextText: row.context_text, contextSha256: row.context_sha256 },
    { ...scope, responseId: row.response_id, decisionId: row.decision_id });
  if (context.project.id !== row.project_id || (row.operation !== "withdraw" && row.context_sha256 !== payload.expectedContextSha256)) throw new Error("Saved decision context differs");
  return { ...row, context };
}

export function decisionLinkPayload(scope: DecisionLinkScope, intent: DecisionLinkIntent) {
  const { requestId: _request, ...payload } = intent;
  return { campaignId: scope.campaignId, ...payload };
}

/** A save acknowledgement must match the exact actor and intent, including an old replay. */
export async function readDecisionLinkReceipt(raw: unknown, scope: DecisionLinkScope & { actorId: string }, intent: DecisionLinkIntent) {
  const receipt = receiptSchema.parse(raw);
  const link = await readDecisionLink(receipt.link, scope);
  if (link.id !== intent.requestId || link.actor_id !== scope.actorId || !same(link.payload_json, decisionLinkPayload(scope, intent))) throw new Error("Decision receipt does not match the request");
  return { receipt, link };
}

/** Validate an exact historical inventory without consulting or inventing current source states. */
export async function readDecisionLinkHistory(raw: unknown, scope: DecisionLinkScope) {
  const history = z.object({ entryCount: count, entries: decisionLinkRowSchema.array() }).strict().parse(raw);
  if (history.entryCount !== history.entries.length) throw new Error("Decision link inventory is incomplete");
  const entries = await Promise.all(history.entries.map(row => readDecisionLink(row, scope)));
  const byId = new Map(entries.map(row => [row.id, row]));
  if (byId.size !== entries.length) throw new Error("Duplicate decision records");
  const children = new Set<string>(), roots = new Set<string>(), resolved = new Set<string>();
  for (const row of entries) {
    if (row.predecessor_id === null) {
      const pair = JSON.stringify([row.response_id, row.decision_id]);
      if (roots.has(pair)) throw new Error("Duplicate decision link root");
      roots.add(pair);
    } else {
      const previous = byId.get(row.predecessor_id);
      if (!previous || children.has(previous.id) || previous.response_id !== row.response_id
        || previous.decision_id !== row.decision_id || previous.project_id !== row.project_id
        || (row.operation === "withdraw" && (previous.operation === "withdraw" || row.context_text !== previous.context_text))) throw new Error("Invalid decision link predecessor");
      children.add(previous.id);
    }
    const seen = new Set<string>();
    let parent: DecisionLinkRow | undefined = row;
    while (parent && !resolved.has(parent.id)) {
      if (seen.has(parent.id)) throw new Error("Decision link history has a cycle");
      seen.add(parent.id);
      parent = parent.predecessor_id === null ? undefined : byId.get(parent.predecessor_id);
    }
    for (const key of seen) resolved.add(key);
  }
  const leaves = entries.filter(row => !children.has(row.id));
  return { entries, leaves };
}

/** Check complete nonforking chains and their current source states before treating an empty list as fact. */
export async function readDecisionLinkSnapshot(raw: unknown, scope: DecisionLinkScope): Promise<DecisionLinkSnapshot> {
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.campaignId !== scope.campaignId || snapshot.workspaceId !== scope.workspaceId
    || snapshot.entryCount !== snapshot.entries.length || snapshot.decisionCount !== snapshot.decisions.length
    || snapshot.currentCount !== snapshot.current.length) throw new Error("Decision link inventory is incomplete");
  if (new Set(snapshot.decisions.map(row => row.record.id)).size !== snapshot.decisions.length) throw new Error("Duplicate decision records");
  const { entries, leaves } = await readDecisionLinkHistory({ entryCount: snapshot.entryCount, entries: snapshot.entries }, scope);
  if (leaves.length !== snapshot.currentCount || new Set(snapshot.current.map(row => row.linkId)).size !== leaves.length) throw new Error("Current decision links are incomplete");
  for (const state of snapshot.current) {
    const leaf = leaves.find(row => row.id === state.linkId);
    if (!leaf || (state.sourceState === "unavailable"
      ? state.currentContextSha256 !== null || state.unavailableReason === null
      : state.currentContextSha256 === null || state.unavailableReason !== null
        || (state.sourceState === "unchanged") !== (state.currentContextSha256 === leaf.context_sha256))) throw new Error("Current decision source state differs");
  }
  return { ...snapshot, entries };
}
