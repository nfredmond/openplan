import { CHAT_PROFILE, CHAT_PROJECTION, CHAT_LIMITS, canonicalChat, chatDefinitions, chatHash, chatProjectionDefinition, checkChatGrant, unknownChatCost, type ChatEnvelope } from "@/lib/assistant/provider-chat-task";
export const chatIds = Object.fromEntries(["user", "workspace", "project", "turn", "grant", "prepare", "accept", "request", "connection", "revision", "capability", "installation", "pool", "poolRevision", "envelope", "step", "call", "handle"].map((k, i) => [k, `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`]));
export function chatFixture(includeWorkspaceIndex = false) {
 const id = chatIds, capturedAt = "2026-10-21T22:00:00.000Z";
 const scope = { target: { kind: "project" as const, id: id.project, workspaceId: id.workspace }, selectedProjectIds: [id.project], includeWorkspaceIndex };
 const definitions = chatDefinitions(scope);
 const anchors = [
  { anchorId: `membership:${id.workspace}:${id.user}`, kind: "membership", table: "workspace_members", primaryKey: `${id.workspace}:${id.user}`, workspaceId: id.workspace, projectId: null },
  { anchorId: `workspace:${id.workspace}`, kind: "workspace", table: "workspaces", primaryKey: id.workspace, workspaceId: id.workspace, projectId: null },
  { anchorId: `project:${id.project}`, kind: "project", table: "projects", primaryKey: id.project, workspaceId: id.workspace, projectId: id.project },
 ].map(a => ({ ...a, permission: "read", projectionId: CHAT_PROJECTION.id, projectionRevision: 1, observedVersion: null, observedAt: capturedAt }));
 const content = canonicalChat({ id: id.project, name: "Synthetic selected project", summary: "Synthetic source text", status: "active", planType: "other", deliveryPhase: "planning", updatedAt: null, href: `/projects/${id.project}` });
 const envelope = { envelopeId: id.envelope, turnId: id.turn, stepId: null, dataClass: "selected_project_summary", projectionId: CHAT_PROJECTION.id, projectionRevision: 1, capturedAt,
  sources: anchors.map(a => ({ table: a.table, primaryKey: a.primaryKey, observedVersion: null })), accessAnchors: anchors, queryDependency: null,
  canonicalProjectedContent: content, contentHash: chatHash(content), availability: "available", omissions: [...CHAT_PROJECTION.excluded], truncation: false } as ChatEnvelope;
 const configurationCanonical = JSON.stringify({ label: "Synthetic saved API", protocol: "openai_chat_completions", endpoint: "https://model.fixture.invalid/v1/", modelIds: ["synthetic-model"], structuredOutput: true, authMode: "none", timeoutSeconds: 60 });
 const workspaceContent = canonicalChat({ workspaceId: id.workspace, workspaceName: "Synthetic workspace" });
 const workspaceEnvelope = { ...envelope, envelopeId: id.handle, dataClass: "workspace_identity", sources: envelope.sources.slice(0, 2), accessAnchors: envelope.accessAnchors.slice(0, 2), canonicalProjectedContent: workspaceContent, contentHash: chatHash(workspaceContent) };
 return checkChatGrant({ domain: "OpenPlan.AssistantChatGrant", version: 1, grantId: id.grant, prepareRequestId: id.prepare, acceptanceRequestId: id.accept, turnRequestId: id.request, turnId: id.turn,
  owner: { userId: id.user, workspaceId: id.workspace, installationId: id.installation, appOrigin: "https://app.fixture.invalid" }, task: { family: "assistant_chat", version: 1 },
  profile: { id: CHAT_PROFILE.id, revision: 1, definitionHash: chatHash(definitions.profileCanonical), definitionCanonical: definitions.profileCanonical, projectionId: CHAT_PROJECTION.id, projectionRevision: 1, limits: CHAT_LIMITS },
  catalog: { revision: 1, definitionHash: chatHash(definitions.catalogCanonical), definitionCanonical: definitions.catalogCanonical, tools: definitions.tools.map(t => t.name) },
  scope: { ...scope, dataClasses: ["workspace_identity", "planner_request", "selected_project_summary", "draft_submittal_intent", ...(includeWorkspaceIndex ? ["workspace_project_index"] : [])].sort(),
   resourceRules: "explicit_project_ids;index_does_not_expand_scope", projectionDefinitions: canonicalChat(chatProjectionDefinition()), historyPolicy: "none" },
  packet: { version: 1, question: "Propose a draft submittal", history: [], capturedAt, initialEnvelopes: [workspaceEnvelope, envelope] },
  selection: { kind: "saved_api", provider: "api_connection", connectionId: id.connection, revisionId: id.revision, configurationCanonical, configurationHash: chatHash(configurationCanonical),
   protocol: "openai_chat_completions", endpoint: "https://model.fixture.invalid/v1/", modelId: "synthetic-model", authMode: "connection_no_key",
   authRevision: { revisionId: id.revision, credentialBindingRevision: id.revision }, credentialSource: { kind: "saved_connection_no_key", connectionId: id.connection },
   capabilityRecordId: id.capability, capabilityRecordHash: "a".repeat(64), execution: { kind: "worker_pool", installationId: id.installation, poolId: id.pool, poolConfigurationRevision: id.poolRevision },
   chargeAcknowledgment: { accepted: true, acknowledgedByUserId: id.user, disclosureVersion: 1, mode: "keyless_unknown_operation" }, costDisclosure: unknownChatCost },
  preparedAt: capturedAt, acceptBefore: "2099-01-01T00:05:00.000Z", expiresAt: "2099-01-01T00:20:00.000Z" });
}
export function chatStreamFrame(delta: unknown, finish_reason: "stop" | "tool_calls" | null = null, extra = {}) {
 return `data: ${JSON.stringify({ id: "synthetic-response", object: "chat.completion.chunk", created: 1, model: "synthetic-model", choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`;
}
export const chatNativeFixtures = ["codex", "claude", "opencode"].map(provider => ({ kind: "native", provider, authMode: provider === "codex" ? "chatgpt" : provider === "claude" ? "claude_subscription" : "opencode_api",
 execution: { kind: "paired_device", deviceId: chatIds.connection, pairingEpoch: 1 }, status: "unassessed", limitation: "No admitted native account revision, tool isolation or model-step/retry evidence." }));
