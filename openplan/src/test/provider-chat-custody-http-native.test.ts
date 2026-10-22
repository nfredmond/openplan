// @vitest-environment node
import { parseChatRpcResult } from "@/lib/assistant/provider-chat-rpc";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv, liveClient, LIVE_RLS, type LocalSupabaseEnv } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { chatFixture, chatIds, chatStreamFrame } from "./fixtures/provider-chat-fixture";
import { canonicalChat, chatDefinitions, chatGrantDigest, chatHash, checkChatGrant } from "@/lib/assistant/provider-chat-task";
import { chatSessionRpc, chatTranscript, readChatSnapshot } from "@/lib/assistant/provider-chat-server";
import { checkChatStream } from "@/lib/assistant/provider-chat-transport";
import { invokeReservedChatTool, retainChatToolReservation } from "@/lib/assistant/chat-tools";
import { executableProjectSubmittalAction } from "@/lib/assistant/project-submittal-receipt";

// Synthetic local identities and HTTP only. Neither admission alone starts SQL.
// No provider exchange, mounted approval route or installed backend is exercised.
const live = LIVE_RLS && process.env.OPENPLAN_CHAT_NATIVE_FIXTURE === "1" ? describe : describe.skip;
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
type Fixture = { grant: ReturnType<typeof chatFixture>; owner: SupabaseClient; other: SupabaseClient; anon: SupabaseClient; service: SupabaseClient };

live("saved API chat custody over signed local HTTP", () => {
 let env: LocalSupabaseEnv, container: string, signingSecret: string;
 function sql(statement: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"],
   { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
 }
 beforeAll(() => {
  const workdir = process.env.OPENPLAN_SUPABASE_WORKDIR ?? "";
  if (!isAbsolute(workdir)) throw new Error("Chat HTTP fixtures require an explicit isolated stack path.");
  env = getLocalSupabaseEnv(); container = resolveLocalDbContainer();
  const inspected = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0];
  expect(inspected.Config.Labels["com.supabase.cli.workdir"]).toBe(workdir);
  expect(inspected.State.Running).toBe(true);
  expect(inspected.NetworkSettings.Ports["5432/tcp"].some((binding: { HostPort: string }) => binding.HostPort === new URL(env.DB_URL).port)).toBe(true);
  if (!["127.0.0.1", "localhost"].includes(new URL(env.API_URL).hostname)) throw new Error("Chat HTTP fixtures require a local API.");
  // The CLI returns local signing material into memory only, never evidence logs.
  const status = execFileSync("npm", ["exec", "--", "supabase", "status", "-o", "env", "--workdir", workdir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const value = status.split(/\r?\n/).find(line => line.startsWith("JWT_SECRET="))?.slice("JWT_SECRET=".length);
  if (!value) throw new Error("Local synthetic JWT signing material unavailable.");
  signingSecret = value.replace(/^"|"$/g, "");
 });
 function authenticated(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", is_anonymous: false, iat: now, exp: now + 300 })).toString("base64url");
  const body = `${header}.${claims}`, token = `${body}.${createHmac("sha256", signingSecret).update(body).digest("base64url")}`;
  return createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, accessToken: async () => token });
 }
 async function fixture(question: string, body: (fixture: Fixture) => Promise<void>) {
  // Rebind only fixture identities; retain the maintained scope/profile/payload definitions.
  let encoded = canonicalChat(chatFixture());
  for (const original of Object.values(chatIds)) encoded = encoded.replaceAll(original, randomUUID());
  const rebound: ReturnType<typeof chatFixture> = JSON.parse(encoded);
  for (const envelope of rebound.packet.initialEnvelopes) envelope.contentHash = chatHash(envelope.canonicalProjectedContent);
  const grant = checkChatGrant(rebound), otherUser = randomUUID(), id = grant.owner;
  const now = Date.now(); grant.packet.question = question;
  grant.preparedAt = new Date(now).toISOString(); grant.acceptBefore = new Date(now + 60000).toISOString(); grant.expiresAt = new Date(now + 600000).toISOString();
  const { capabilityRecordId: _cap, capabilityRecordHash: _hash, chargeAcknowledgment: _ack, costDisclosure: _cost, ...selection } = grant.selection;
  const admission = canonicalChat({ workspaceId: id.workspaceId, selection, profileCanonical: grant.profile.definitionCanonical, projectionCanonical: grant.scope.projectionDefinitions,
   catalogCanonicals: [grant.catalog.definitionCanonical], evidence: { sourceReview: "Synthetic fixture only", databaseEvidence: "Synthetic fixture only", protocolEvidence: "Synthetic fixture only", browserEvidence: "Synthetic fixture only", admittedBy: id.userId, admittedAt: grant.preparedAt } });
  grant.selection.capabilityRecordHash = chatHash(admission);
  // Setup is one transaction. A setup error rolls back without authorizing cleanup.
  const setup = sql(`BEGIN;
   INSERT INTO auth.users(id,email) VALUES('${id.userId}','${id.userId}@example.test'),('${otherUser}','${otherUser}@example.test');
   DO $$ BEGIN
    IF (SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${id.userId}','${otherUser}') AND role='owner') <> 2
     OR (SELECT count(DISTINCT workspace_id) FROM public.workspace_members WHERE user_id IN ('${id.userId}','${otherUser}')) <> 2
    THEN RAISE EXCEPTION 'Synthetic onboarding ownership invalid'; END IF;
   END $$;
   SELECT 'CHAT_HTTP_BOOTSTRAP:'||coalesce(jsonb_agg(workspace_id)::text,'[]') FROM public.workspace_members WHERE user_id IN ('${id.userId}','${otherUser}');
   INSERT INTO public.workspaces(id,name,slug) VALUES('${id.workspaceId}','Synthetic workspace','${id.workspaceId}');
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${id.workspaceId}','${id.userId}','owner');
   INSERT INTO public.projects(id,workspace_id,name) VALUES('${grant.scope.selectedProjectIds[0]}','${id.workspaceId}','Synthetic selected project');
   SELECT public.save_workspace_provider_api_revision('${id.userId}','${id.workspaceId}','${selection.connectionId}','${selection.revisionId}',NULL,${literal(selection.configurationCanonical)},NULL);
   INSERT INTO public.assistant_chat_admissions VALUES('${grant.selection.capabilityRecordId}',${literal(admission)},'${grant.selection.capabilityRecordHash}',true,NULL);
   COMMIT;`);
  const bootstrapLine = setup.split("\n").find(line => line.startsWith("CHAT_HTTP_BOOTSTRAP:"));
  if (!bootstrapLine) throw new Error("Synthetic onboarding workspace identities missing.");
  const bootstrapIds: unknown = JSON.parse(bootstrapLine.slice("CHAT_HTTP_BOOTSTRAP:".length));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!Array.isArray(bootstrapIds) || bootstrapIds.length !== 2 || new Set(bootstrapIds).size !== 2
   || bootstrapIds.some(value => typeof value !== "string" || !uuid.test(value) || value === id.workspaceId)) throw new Error("Synthetic onboarding workspace identities invalid.");
  const ownedWorkspaces = [id.workspaceId, ...bootstrapIds as string[]].map(literal).join(",");
  let bodyFailure: { error: unknown } | undefined;
  try {
   await body({ grant, owner: authenticated(id.userId), other: authenticated(otherUser), anon: liveClient(env.API_URL, env.ANON_KEY), service: liveClient(env.API_URL, env.SERVICE_ROLE_KEY) });
  } catch (error) {
   bodyFailure = { error }; throw error;
  } finally {
   // Delete only this invocation's exact UUID rows, including dependent custody.
   try {
    sql(`BEGIN;
    SELECT id FROM public.workspaces WHERE id IN (${ownedWorkspaces}) FOR UPDATE;
    DO $$ BEGIN
     IF (SELECT count(*) FROM public.workspaces WHERE id IN (${ownedWorkspaces})) <> 3
      OR EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id IN (${ownedWorkspaces}) AND user_id NOT IN ('${id.userId}','${otherUser}'))
      OR EXISTS(SELECT 1 FROM auth.users WHERE id IN ('${id.userId}','${otherUser}') AND email <> id::text||'@example.test')
     THEN RAISE EXCEPTION 'Synthetic workspace cleanup ownership invalid'; END IF;
    END $$;
    DELETE FROM public.assistant_chat_proposal_intents WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_access_checks WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_events WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_tool_calls WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_steps WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_sources WHERE turn_id='${grant.turnId}';
    DELETE FROM public.assistant_chat_turns WHERE id='${grant.turnId}';
    DELETE FROM public.assistant_chat_grants WHERE id='${grant.grantId}';
    DELETE FROM public.assistant_chat_admissions WHERE id='${grant.selection.capabilityRecordId}';
    DELETE FROM public.usage_events WHERE workspace_id='${id.workspaceId}' AND bucket_key='assistant_chat' AND source_route='/api/assistant/providers/chat';
    DELETE FROM public.projects WHERE id='${grant.scope.selectedProjectIds[0]}' AND workspace_id='${id.workspaceId}';
    DELETE FROM public.workspace_provider_api_connections WHERE id='${selection.connectionId}' AND workspace_id='${id.workspaceId}';
    DELETE FROM public.workspaces WHERE id IN (${ownedWorkspaces});
    DELETE FROM auth.users WHERE id IN ('${id.userId}','${otherUser}');
    COMMIT;`);
   } catch (cleanupError) {
    if (bodyFailure) throw new AggregateError([bodyFailure.error, cleanupError], "HTTP body and exact fixture cleanup both failed", { cause: bodyFailure.error });
    throw cleanupError;
   }
  }
 }
 async function start(f: Fixture) {
  const canonical = canonicalChat(f.grant), digest = chatGrantDigest(f.grant);
  const prepared = await chatSessionRpc(f.owner, "prepare", f.grant.turnId, { canonical, digest });
  expect(prepared).toMatchObject({ released: true, canonical, digest, turnId: f.grant.turnId });
  expect(await chatSessionRpc(f.owner, "accept", f.grant.turnId, { acceptanceRequestId: f.grant.acceptanceRequestId, digest })).toMatchObject({ released: true, state: "accepted" });
  expect(await chatSessionRpc(f.owner, "start", f.grant.turnId)).toMatchObject({ started: true });
 }
 async function dispatch(f: Fixture, sequence: number, stepId: string) {
  const { snapshot } = await readChatSnapshot(f.owner, f.grant.turnId);
  const request = JSON.stringify({ model: f.grant.selection.modelId, stream: true, max_tokens: 2000, tool_choice: "auto", stream_options: { include_usage: true },
   messages: chatTranscript(f.grant, snapshot), tools: chatDefinitions(f.grant.scope).tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) });
  expect(await chatSessionRpc(f.owner, "dispatch", f.grant.turnId, { sequence, stepId, request })).toMatchObject({ released: true });
 }
 async function finish(f: Fixture, stepId: string, rawBody: string) {
  const receipt = checkChatStream(rawBody, f.grant.selection.modelId, f.grant.catalog.tools), receiptHash = chatHash(canonicalChat(receipt));
  expect(await chatSessionRpc(f.owner, "finish_step", f.grant.turnId, { stepId, receipt, receiptHash })).toMatchObject({ released: true });
  return { receipt, receiptHash };
 }
 // Authored only. Historical R36 installed430 is not this corrected installation.
 it.each([100, 101, 205])("pages %i events over signed HTTP with replay, later append and terminal reconnect", async total => {
  await fixture("Read every retained event page", async f => {
   await start(f); const stepId = randomUUID(); await dispatch(f, 1, stepId);
   const seed = await readChatSnapshot(f.owner, f.grant.turnId);
   expect(seed.snapshot.cursor).toBe(3);
   // Seed real progress through the same public RPC under the fixture owner.
   // Page observations below still cross actual PostgREST and the locked decoder.
   sql(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',${literal(JSON.stringify({ sub: f.grant.owner.userId, role: "authenticated", is_anonymous: false }))},true);
    DO $$ DECLARE n int; BEGIN FOR n IN 1..${total - 3} LOOP
     PERFORM public.assistant_chat_session('progress','${f.grant.turnId}',jsonb_build_object('stepId','${stepId}','frameSequence',n,'text','x'));
    END LOOP; END $$; COMMIT;`);
   let after = 0, previousHash: string | null = null;
   const sequences: number[] = [];
   async function readPage() {
    const { snapshot } = await readChatSnapshot(f.owner, f.grant.turnId, after);
    expect(snapshot.events.length).toBeLessThanOrEqual(100);
    expect((await readChatSnapshot(f.owner, f.grant.turnId, after)).snapshot).toEqual(snapshot);
    for (const event of snapshot.events) {
     expect(event.sequence).toBe(after + 1); expect(event.previous_hash).toBe(previousHash);
     expect(event.body_hash).toBe(chatHash(canonicalChat(event.body)));
     after = event.sequence; previousHash = event.body_hash; sequences.push(after);
    }
    expect(snapshot.cursor, "HTTP cursor stops at the last event actually returned").toBe(after);
    return snapshot;
   }
   for (let n = 0; n < Math.ceil(total / 100); n++) await readPage();
   expect(sequences).toEqual(Array.from({ length: total }, (_, n) => n + 1));
   expect((await readPage()).events).toEqual([]);
   expect(await chatSessionRpc(f.owner, "progress", f.grant.turnId, { stepId, frameSequence: total - 2, text: "x" })).toMatchObject({ released: true });
   expect((await readPage()).events).toHaveLength(1);
   const raw = chatStreamFrame({ role: "assistant", content: "x".repeat(total - 2) }, "stop") + "data: [DONE]\n\n";
   await finish(f, stepId, raw);
   const terminal = await readPage(); expect(terminal.state).toBe("succeeded"); expect(terminal.events).toHaveLength(2);
   expect(after).toBe(total + 3); expect((await readPage()).events).toEqual([]);
   after = 0; previousHash = null; sequences.length = 0;
   for (let n = 0; n < Math.ceil((total + 3) / 100); n++) expect((await readPage()).state).toBe("succeeded");
   expect(sequences).toEqual(Array.from({ length: total + 3 }, (_, n) => n + 1));
   expect((await readPage()).events).toEqual([]);
  });
 });
 it.each(["Plain question", "\u0000", "literal \\u0000", "\ue000😀\n\u0000\t\b\f\r"])("round-trips exact canonical question %j through PostgREST", async question => {
  await fixture(question, async f => {
   await start(f);
   const { snapshot } = await readChatSnapshot(f.owner, f.grant.turnId);
   expect(snapshot.state).toBe("running");
   // HTTP canonical guard: compare exact bytes after locked client JSON decoding.
   expect(snapshot.canonical).toBe(canonicalChat(f.grant));
   expect(Buffer.from(snapshot.canonical)).toEqual(Buffer.from(canonicalChat(f.grant)));
   expect(JSON.parse(snapshot.canonical).packet.question).toBe(question);
   expect(snapshot.digest).toBe(chatGrantDigest(f.grant));
   expect(snapshot.digest).toBe(chatHash("OpenPlan.AssistantChatGrant.v1\n" + snapshot.canonical));
  });
 });
 it("retains NUL progress and terminal raw bytes, receipt and event hashes over HTTP", async () => {
  await fixture("Retain exact synthetic text", async f => {
   await start(f); const stepId = randomUUID(), text = "a\u0000\u0000😀\n\tend";
   const rawBody = chatStreamFrame({ role: "assistant", content: text }, "stop") + "data: [DONE]\n\n";
   await dispatch(f, 1, stepId);
   expect(await chatSessionRpc(f.owner, "progress", f.grant.turnId, { stepId, frameSequence: 1, text, bodyHash: chatHash(text) })).toMatchObject({ released: true });
   const { receipt, receiptHash } = await finish(f, stepId, rawBody);
   const { snapshot } = await readChatSnapshot(f.owner, f.grant.turnId);
   expect(snapshot.state).toBe("succeeded");
   expect(snapshot.steps[0].receipt).toEqual(receipt);
   expect(snapshot.steps[0].receipt?.text).toBe(text);
   expect(snapshot.steps[0].receipt?.rawBody).toBe(rawBody);
   expect(snapshot.steps[0].receipt?.bodyHash).toBe(chatHash(rawBody));
   expect(snapshot.steps[0].receipt_hash).toBe(receiptHash);
   expect(snapshot.steps[0].receipt_hash).toBe(chatHash(canonicalChat(snapshot.steps[0].receipt)));
   const delta = snapshot.events.find(event => event.kind === "text_delta");
   expect(delta?.body).toMatchObject({ text });
   expect(delta?.body_hash).toBe(chatHash(canonicalChat(delta?.body)));
   expect(JSON.stringify(snapshot)).not.toContain("$openplan_chat_nul_v1");
  });
 });
 it("denies another signed actor, anonymous and service body reads and original approval issuance", async () => {
  await fixture("Private synthetic question", async f => {
   await start(f); const stepId = randomUUID(), input = { projectId: f.grant.scope.selectedProjectIds[0], title: "Private synthetic draft", submittalType: "other" as const, notes: "Private synthetic notes" };
   await dispatch(f, 1, stepId);
   await finish(f, stepId, chatStreamFrame({ role: "assistant", tool_calls: [{ index: 0, id: "http_draft", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n");
   const retained = await readChatSnapshot(f.owner, f.grant.turnId), call = retained.snapshot.calls[0];
   const claim = await chatSessionRpc(f.owner, "claim_tool", f.grant.turnId, { callId: call.id });
   const broker = await invokeReservedChatTool({ session: f.owner, userId: f.grant.owner.userId, grant: f.grant, reservation: retainChatToolReservation(claim) });
   if (!("executableCanonical" in broker) || !broker.executableCanonical || !("intentId" in broker.result)) throw new Error("Actual HTTP draft missing");
   await chatSessionRpc(f.owner, "finish_tool", f.grant.turnId, { callId: call.id, handle: claim.handle, ...broker });
   const nextStep = randomUUID(); await dispatch(f, 2, nextStep);
   await finish(f, nextStep, chatStreamFrame({ role: "assistant", content: "Synthetic complete answer" }, "stop") + "data: [DONE]\n\n");
   const intentId = String(broker.result.intentId), action = executableProjectSubmittalAction({ kind: "create_project_record", recordType: "submittal", status: "draft", ...input });
   const issuePayload = { expectedExecutableHash: chatHash(broker.executableCanonical), expectedGrantDigest: chatGrantDigest(f.grant), executableCanonical: broker.executableCanonical,
    approvalRequestId: randomUUID(), approvalId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), executionContext: { version: 1, action,
     project: { id: input.projectId, workspaceId: f.grant.owner.workspaceId, name: "Synthetic selected project" } } };
   const ownIntent = await f.owner.rpc("assistant_chat_intent", { p_operation: "read", p_intent_id: intentId, p_payload: {} });
   expect(ownIntent.error).toBeNull(); expect(parseChatRpcResult(ownIntent.data)).toMatchObject({ released: true, intent: { state: "proposed", executable_canonical: broker.executableCanonical, original_approval_id: null } });
   for (const [actor, client] of [["other", f.other], ["anon", f.anon], ["service", f.service]] as const) {
    for (const operation of ["session_read", "intent_read", "intent_issue"] as const) {
     const name = operation === "session_read" ? "assistant_chat_session" : "assistant_chat_intent";
     const reply = operation === "session_read"
      ? await client.rpc(name, { p_operation: "read", p_turn_id: f.grant.turnId, p_payload: {} })
      : await client.rpc(name, { p_operation: operation === "intent_read" ? "read" : "issue", p_intent_id: intentId, p_payload: { canonicalPayload: canonicalChat(operation === "intent_issue" ? issuePayload : {}) } });
     const message = actor === "other" ? (operation === "session_read" ? "Chat owner denied" : "Intent denied") : `permission denied for function ${name}`;
     // HTTP denial guard includes the actual PostgREST error envelope and no data.
     expect(reply, `${actor}/${operation}`).toMatchObject({ data: null, error: { code: "42501", message } });
     expect(reply.status, `${actor}/${operation} HTTP status`).toBe(actor === "anon" ? 401 : 403);
     const serialized = JSON.stringify(reply);
     for (const secret of [f.grant.packet.question, input.title, input.notes, broker.executableCanonical, canonicalChat(f.grant), f.grant.packet.initialEnvelopes[1].canonicalProjectedContent]) expect(serialized).not.toContain(secret);
    }
   }
   const status = await f.owner.rpc("assistant_chat_intent", { p_operation: "status", p_intent_id: intentId, p_payload: {} });
   expect(status.error).toBeNull(); expect(parseChatRpcResult(status.data)).toMatchObject({ state: "proposed", originalApprovalId: null });
   expect(sql(`SELECT count(*) FROM public.assistant_action_approvals WHERE workspace_id='${f.grant.owner.workspaceId}';`).trim()).toBe("0");
  });
 });
});
