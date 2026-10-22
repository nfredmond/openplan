import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { CHAT_INSTRUCTIONS, chatDraftSchema, canonicalChat, chatGrantDigest, chatHash } from "@/lib/assistant/provider-chat-task";
import { invokeReservedChatTool, retainChatToolReservation } from "@/lib/assistant/chat-tools";
import type { ChatSession } from "@/lib/assistant/provider-chat-projection";
import type { ChatWireMessage } from "@/lib/assistant/provider-chat-transport";
import { runChatModelStep } from "@/lib/assistant/provider-chat-worker";
import { checkChatStream } from "@/lib/assistant/provider-chat-transport";
import { executableProjectSubmittalAction } from "@/lib/assistant/project-submittal-receipt";
import { chatFixture, chatIds as id, chatStreamFrame as frame } from "./fixtures/provider-chat-fixture";

const sdk = vi.hoisted(() => ({ network: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/assistant/provider-api-transport", async original => ({ ...await original<object>(), pinnedProviderExchange: sdk.network }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: sdk.service }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

// SOURCE ONLY, UNRUN. The SDK uses a mocked policy-neutral exchange, with no
// real endpoint/model call. SQL fixtures require separate isolated admission. A later
// explicit isolated-stack admission is required before invoking this file.
const live = LIVE_RLS && process.env.OPENPLAN_CHAT_NATIVE_FIXTURE === "1" ? describe : describe.skip;
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
// These rows are exercised inside both original approval/receipt fixture variants.
const CHAT_DIRECT_RLS_TABLES = [
 "assistant_action_approvals",
 "assistant_chat_access_checks",
 "assistant_chat_grants",
 "assistant_chat_proposal_intents",
 "assistant_chat_turns",
] as const;
live("chat custody native fixtures", () => {
 let container: string;
 beforeAll(() => {
  if (!isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) throw new Error("Chat native fixtures require an explicit isolated stack path.");
  container = resolveLocalDbContainer();
 });
 function exercise(body: (rpc: (op: string, payload?: unknown) => string, intent: (op: string, payload?: unknown) => string) => string, grant = chatFixture(), intentId = id.call) {
  // Keep the workspace valid when the original grant owner loses access.
  const secondOwner = randomUUID();
  const now = Date.now(); grant.preparedAt = new Date(now).toISOString(); grant.acceptBefore = new Date(now + 60000).toISOString(); grant.expiresAt = new Date(now + 600000).toISOString();
  const { capabilityRecordId: _cap, capabilityRecordHash: _hash, chargeAcknowledgment: _ack, costDisclosure: _cost, ...selection } = grant.selection;
  const admission = canonicalChat({ workspaceId: id.workspace, selection, profileCanonical: grant.profile.definitionCanonical, projectionCanonical: grant.scope.projectionDefinitions,
   catalogCanonicals: [grant.catalog.definitionCanonical], evidence: { sourceReview: "Synthetic fixture only", databaseEvidence: "Synthetic fixture only", protocolEvidence: "Synthetic fixture only", browserEvidence: "Synthetic fixture only", admittedBy: id.user, admittedAt: grant.preparedAt } });
  grant.selection.capabilityRecordHash = chatHash(admission); const canonical = canonicalChat(grant), digest = chatGrantDigest(grant);
  // Decode only the public transport envelope. Every call retains its original
  // authenticated/service role and public authorization path. Logical assertions stay exact.
  const rpc = (op: string, payload: unknown = {}) => `(((public.assistant_chat_session(${literal(op)},'${id.turn}',${literal(JSON.stringify({ canonicalPayload: canonicalChat(payload) }))}::jsonb)->>'canonicalResult')::json)::jsonb)`;
  const intent = (op: string, payload: unknown = {}) => `(((public.assistant_chat_intent(${literal(op)},'${intentId}',${literal(JSON.stringify({ canonicalPayload: canonicalChat(payload) }))}::jsonb)->>'canonicalResult')::json)::jsonb)`;
  const sql = `BEGIN;
   INSERT INTO auth.users(id,email) VALUES('${id.user}','${id.user}@example.test'),('${secondOwner}','${secondOwner}@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES('${id.workspace}','Synthetic workspace','${id.workspace}'),('${id.pool}','Synthetic move destination','${id.pool}');
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${id.workspace}','${id.user}','owner'),('${id.pool}','${id.user}','owner'),('${id.workspace}','${secondOwner}','owner');
   INSERT INTO public.projects(id,workspace_id,name) VALUES('${id.project}','${id.workspace}','Synthetic selected project');
   SELECT public.save_workspace_provider_api_revision('${id.user}','${id.workspace}','${id.connection}','${id.revision}',NULL,${literal(selection.configurationCanonical)},NULL);
   INSERT INTO public.assistant_chat_admissions VALUES('${id.capability}',${literal(admission)},'${grant.selection.capabilityRecordHash}',true,NULL);
   CREATE FUNCTION pg_temp.chat_wire_request() RETURNS text LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT jsonb_build_object('model','synthetic-model','stream',true,'max_tokens',2000,'tool_choice','auto','stream_options','{"include_usage":true}'::jsonb,
     'messages',assistant_chat_private.expected_messages('${id.turn}'),'tools',(SELECT jsonb_agg(jsonb_build_object('type','function','function',jsonb_build_object('name',d->>'name','description',d->>'description','parameters',d->'inputSchema')) ORDER BY ordinality)
      FROM public.assistant_chat_grants g CROSS JOIN LATERAL jsonb_array_elements((assistant_chat_private.lossless(g.canonical::json)->'catalog'->>'definitionCanonical')::jsonb) WITH ORDINALITY d(d,ordinality) WHERE g.id='${id.grant}'))::text;
   $f$;
   CREATE FUNCTION pg_temp.chat_first_call() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT id FROM public.assistant_chat_tool_calls WHERE turn_id='${id.turn}' ORDER BY id LIMIT 1;
   $f$;
   CREATE FUNCTION pg_temp.chat_first_handle() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT handle FROM public.assistant_chat_tool_calls WHERE turn_id='${id.turn}' ORDER BY id LIMIT 1;
   $f$;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims',${literal(JSON.stringify({ sub: id.user, role: "authenticated", is_anonymous: false }))},true);
   SELECT ${rpc("prepare", { canonical, digest })};
   SELECT ${rpc("accept", { acceptanceRequestId: grant.acceptanceRequestId, digest })};
   SELECT ${rpc("start")};
   ${body(rpc, intent)}
   SELECT 'CHAT_NATIVE_ASSERTIONS_REACHED'; ROLLBACK;`;
  const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  expect(output).toContain("CHAT_NATIVE_ASSERTIONS_REACHED"); return output;
 }
 function dispatch(sequence: number, stepId: string) {
  return `((public.assistant_chat_session('dispatch','${id.turn}',jsonb_build_object('sequence',${sequence},'stepId','${stepId}','request',pg_temp.chat_wire_request()))->>'canonicalResult')::json)`;
 }
 function terminal(rpc: (op: string, payload?: unknown) => string, stepId: string, calls: Array<{ name: string; input: unknown; id: string }>) {
  const raw = calls.length ? frame({ role: "assistant", tool_calls: calls.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) }, "tool_calls") + "data: [DONE]\n\n" : frame({ role: "assistant", content: "Synthetic complete answer" }, "stop") + "data: [DONE]\n\n";
  const receipt = checkChatStream(raw, "synthetic-model", ["get_surface_context", "propose_create_project_record"]);
  return rpc("finish_step", { stepId, receipt, receiptHash: chatHash(canonicalChat(receipt)) });
 }
 async function reservedDraft(grant: ReturnType<typeof chatFixture>, input: unknown, toolCallId: string) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: id.project, workspace_id: id.workspace }, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const output = await invokeReservedChatTool({ session: { from: vi.fn().mockReturnValue(query) } as unknown as ChatSession, userId: id.user, grant,
   reservation: retainChatToolReservation({ released: true, cached: false, handle: id.handle, callId: id.call, stepId: id.step, toolCallId, name: "propose_create_project_record", input, usedCalls: 1 }) });
  if (!("executableCanonical" in output) || !output.executableCanonical || !("intentId" in output.result) || typeof output.result.intentId !== "string" || typeof output.result.executableHash !== "string") throw new Error("Actual reserved draft output missing");
  return { ...output, executableCanonical: output.executableCanonical, intentId: output.result.intentId, executableHash: output.result.executableHash };
 }
 // Probe real retained rows after original approval issuance, before receipt recovery.
 // The postgres insert controls roll back successful valid copies. A constraint
 // error is never accepted as access denial, and no helper grants are installed.
 function directRlsBoundaries(approvalId: string, intentId: string) {
  const outsiderId = randomUUID(), spareGrantId = randomUUID();
  const grantPatch = () => ({ id: randomUUID(), prepare_request_id: randomUUID(), acceptance_request_id: randomUUID(), turn_request_id: randomUUID() });
  const patches: Record<typeof CHAT_DIRECT_RLS_TABLES[number], Record<string, string | null>> = {
   assistant_action_approvals: { id: randomUUID() },
   assistant_chat_access_checks: { id: randomUUID() },
   assistant_chat_grants: grantPatch(),
   assistant_chat_proposal_intents: { id: randomUUID(), attempt_id: randomUUID(), original_approval_id: null },
   assistant_chat_turns: { id: randomUUID(), grant_id: spareGrantId, attempt_id: randomUUID() },
  };
  const actors = [
   { role: "authenticated", user: id.user },
   { role: "authenticated", user: outsiderId },
   { role: "anon", user: null },
  ];
  const tables = CHAT_DIRECT_RLS_TABLES.map(literal).join(",");
  return `
   DO $$ DECLARE r jsonb; BEGIN
    IF current_user<>'authenticated' OR auth.uid() IS DISTINCT FROM '${id.user}'::uuid THEN RAISE EXCEPTION 'Owner probe identity differs'; END IF;
    r:=((public.assistant_chat_session('read','${id.turn}','{}')->>'canonicalResult')::json)::jsonb;
    IF r->>'released' IS DISTINCT FROM 'true' OR r->>'turnId' IS DISTINCT FROM '${id.turn}' THEN RAISE EXCEPTION 'Owner session read failed'; END IF;
    r:=((public.assistant_chat_intent('read','${intentId}','{}')->>'canonicalResult')::json)::jsonb;
    IF r->>'released' IS DISTINCT FROM 'true' OR r->'intent'->>'id' IS DISTINCT FROM '${intentId}' THEN RAISE EXCEPTION 'Owner intent read failed'; END IF;
    r:=((public.assistant_chat_intent('status','${intentId}','{}')->>'canonicalResult')::json)::jsonb;
    IF r->>'originalApprovalId' IS DISTINCT FROM '${approvalId}' THEN RAISE EXCEPTION 'Owner original approval missing'; END IF;
   END $$;
   RESET ROLE;
   INSERT INTO auth.users(id,email) VALUES('${outsiderId}','${outsiderId}@example.test');
   INSERT INTO public.assistant_chat_grants
    SELECT (jsonb_populate_record(NULL::public.assistant_chat_grants,to_jsonb(g)||${literal(canonicalChat({ ...grantPatch(), id: spareGrantId }))}::jsonb)).*
    FROM public.assistant_chat_grants g WHERE id='${id.grant}';
   DO $$ DECLARE relation_name text; actor jsonb; snapshot jsonb; baseline jsonb:='{}'; copies jsonb:='{}';
    patches jsonb:=${literal(canonicalChat(patches))}::jsonb; candidate jsonb; seen bigint; affected bigint; probes int:=0; refusals int:=0;
   BEGIN
    IF current_user<>'postgres' THEN RAISE EXCEPTION 'Fixture precheck is not postgres'; END IF;
    IF EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id='${id.workspace}' AND user_id='${outsiderId}') THEN RAISE EXCEPTION 'Outsider unexpectedly has membership'; END IF;
    FOREACH relation_name IN ARRAY ARRAY[${tables}] LOOP
     EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]'') FROM public.%I t WHERE workspace_id=$1',relation_name)
      INTO snapshot USING '${id.workspace}'::uuid;
     IF jsonb_array_length(snapshot)=0 THEN RAISE EXCEPTION 'Direct probe has no existing rows: %',relation_name; END IF;
     baseline:=baseline||jsonb_build_object(relation_name,snapshot);
     candidate:=(snapshot->0)||(patches->relation_name);
     copies:=copies||jsonb_build_object(relation_name,candidate);
     -- Success followed by this private sentinel rolls back just the insert.
     -- Any FK, unique, type, check or trigger failure escapes instead.
     BEGIN
      EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',relation_name,relation_name) USING candidate;
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected<>1 THEN RAISE EXCEPTION 'Postgres copy did not insert one row: %',relation_name; END IF;
      RAISE EXCEPTION 'Valid insert control' USING ERRCODE='P0052';
     EXCEPTION WHEN SQLSTATE 'P0052' THEN NULL; END;
    END LOOP;
    FOR actor IN SELECT value FROM jsonb_array_elements(${literal(canonicalChat(actors))}::jsonb) LOOP
     EXECUTE format('SET LOCAL ROLE %I',actor->>'role');
     PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor->'user','role',actor->>'role','is_anonymous',actor->>'role'='anon')::text,true);
     IF current_user IS DISTINCT FROM actor->>'role' OR auth.uid() IS DISTINCT FROM (actor->>'user')::uuid
      OR auth.role() IS DISTINCT FROM actor->>'role' THEN RAISE EXCEPTION 'Direct probe target role or actor differs'; END IF;
     FOREACH relation_name IN ARRAY ARRAY[${tables}] LOOP
      BEGIN
       EXECUTE format('SELECT count(*) FROM public.%I WHERE workspace_id=$1',relation_name) INTO seen USING '${id.workspace}'::uuid;
       IF seen<>0 THEN RAISE EXCEPTION 'Direct SELECT exposed retained rows: %',relation_name; END IF;
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      probes:=probes+1;
      BEGIN
       EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',relation_name,relation_name) USING copies->relation_name;
       RAISE EXCEPTION 'Direct INSERT succeeded: %',relation_name;
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      probes:=probes+1;
      BEGIN
       EXECUTE format('UPDATE public.%I SET workspace_id=$1 WHERE id=$2',relation_name) USING '${id.workspace}'::uuid,(baseline->relation_name->0->>'id')::uuid;
       GET DIAGNOSTICS affected=ROW_COUNT;
       IF affected<>0 THEN RAISE EXCEPTION 'Direct UPDATE reached retained row: %',relation_name; END IF;
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      probes:=probes+1;
      BEGIN
       EXECUTE format('DELETE FROM public.%I WHERE id=$1',relation_name) USING (baseline->relation_name->0->>'id')::uuid;
       GET DIAGNOSTICS affected=ROW_COUNT;
       IF affected<>0 THEN RAISE EXCEPTION 'Direct DELETE reached retained row: %',relation_name; END IF;
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      probes:=probes+1;
     END LOOP;
     IF actor->>'user' IS DISTINCT FROM '${id.user}' THEN
      BEGIN
       PERFORM public.assistant_chat_session('read','${id.turn}','{}');
       RAISE EXCEPTION 'Nonowner session read succeeded';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      refusals:=refusals+1;
      BEGIN
       PERFORM public.assistant_chat_intent('read','${intentId}','{}');
       RAISE EXCEPTION 'Nonowner intent read succeeded';
      EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
      refusals:=refusals+1;
     END IF;
     RESET ROLE;
     IF current_user<>'postgres' THEN RAISE EXCEPTION 'Fixture comparison is not postgres'; END IF;
     FOREACH relation_name IN ARRAY ARRAY[${tables}] LOOP
      EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]'') FROM public.%I t WHERE workspace_id=$1',relation_name)
       INTO snapshot USING '${id.workspace}'::uuid;
      IF snapshot IS DISTINCT FROM baseline->relation_name THEN RAISE EXCEPTION 'Direct probes changed retained rows: %',relation_name; END IF;
     END LOOP;
    END LOOP;
    IF probes<>60 OR refusals<>4 THEN RAISE EXCEPTION 'Direct/RPC probe census differs: %/%',probes,refusals; END IF;
   END $$;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims',${literal(canonicalChat({ sub: id.user, role: "authenticated", is_anonymous: false }))},true);
   SELECT 'CHAT_DIRECT_RLS_ASSERTIONS_REACHED:60:4';`;
 }
 // Fresh-install coverage only. Historical R52's installed430 remains unchanged.
 it.each([100, 101, 205])("drains %i real retained events without skipping a page or hash link", total => {
  // Bind receipt text to the actual command chain, not one event per frame.
  const seedKinds = [["scope_checked"], ["scope_checked", "grant_accepted"], ["scope_checked", "started"], ["scope_checked", "model_dispatch_reserved"]].flat();
  const frameCount = Math.floor((total - seedKinds.length) / 2);
  const raw = frame({ role: "assistant", content: "x".repeat(frameCount + 1) }, "stop") + "data: [DONE]\n\n";
  const receipt = checkChatStream(raw, "synthetic-model", []);
  const read = (after: string) => `(((public.assistant_chat_session('read','${id.turn}',jsonb_build_object('afterSequence',${after}))->>'canonicalResult')::json)::jsonb)`;
  const progress = (sequence: string) => `public.assistant_chat_session('progress','${id.turn}',jsonb_build_object('stepId','${id.step}','frameSequence',${sequence},'text','x'))`;
  exercise(rpc => `SELECT ${dispatch(1, id.step)};
   DO $$ DECLARE seed jsonb; p jsonb; replay jsonb; ev jsonb; after_seq bigint:=0; prev text; i int; seeded int; frames int; BEGIN
    seed:=${read("0")};
    IF seed->>'released' IS DISTINCT FROM 'true' OR (SELECT jsonb_agg(value->>'kind' ORDER BY ordinality) FROM jsonb_array_elements(seed->'events') WITH ORDINALITY) IS DISTINCT FROM ${literal(JSON.stringify(seedKinds))}::jsonb
     OR (seed->>'cursor')::int<>jsonb_array_length(seed->'events') THEN RAISE EXCEPTION 'Pagination seeded command chain differs'; END IF;
    seeded:=(seed->>'cursor')::int;
    IF seeded>=${total} THEN RAISE EXCEPTION 'Pagination target cannot contain setup'; END IF;
    IF (${total}-seeded)%2=1 THEN
     replay:=${rpc("start")}; p:=${read("0")};
     IF replay->>'started' IS DISTINCT FROM 'false' OR replay->>'state'<>'running'
      OR (p-ARRAY['events','cursor','revision']) IS DISTINCT FROM (seed-ARRAY['events','cursor','revision'])
      OR (p->>'revision')::bigint<>(seed->>'revision')::bigint+1 OR (p->>'cursor')::int<>seeded+1
      OR jsonb_array_length(p->'events')<>seeded+1 OR p->'events'->seeded->>'kind'<>'scope_checked'
      OR p->'events'->seeded->'body'->>'purpose'<>'start' THEN RAISE EXCEPTION 'Parity start replay changed effects or lost its check'; END IF;
     seeded:=(p->>'cursor')::int;
    END IF;
    frames:=(${total}-seeded)/2;
    IF (${total}-seeded)%2<>0 OR frames<>${frameCount} THEN RAISE EXCEPTION 'Frame/event accounting differs'; END IF;
    FOR i IN 1..frames LOOP PERFORM ${progress("i")}; END LOOP;
    LOOP
     p:=${read("after_seq")}; replay:=${read("after_seq")};
     IF p IS DISTINCT FROM replay THEN RAISE EXCEPTION 'Same page replay differs'; END IF;
     IF jsonb_array_length(p->'events')>100 THEN RAISE EXCEPTION 'Event page limit widened'; END IF;
     EXIT WHEN jsonb_array_length(p->'events')=0;
     FOR ev IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
      IF (ev->>'sequence')::bigint<>after_seq+1 OR ev->>'previous_hash' IS DISTINCT FROM prev
      THEN RAISE EXCEPTION 'Retained page chain skipped or changed'; END IF;
      after_seq:=(ev->>'sequence')::bigint; prev:=ev->>'body_hash';
     END LOOP;
     IF (p->>'cursor')::bigint<>after_seq THEN RAISE EXCEPTION 'Page cursor skipped returned events'; END IF;
    END LOOP;
    IF after_seq<>${total} OR (p->>'cursor')::bigint<>after_seq THEN RAISE EXCEPTION 'Empty last page lost boundary'; END IF;
    PERFORM ${progress("frames+1")};
    p:=${read("after_seq")};
    IF jsonb_array_length(p->'events')<>2 OR (p->>'cursor')::int<>${total + 2}
     OR p->'events'->0->>'kind'<>'scope_checked' OR p->'events'->0->'body'->>'purpose'<>'progress'
     OR p->'events'->1->>'kind'<>'text_delta' OR (p->'events'->1->'body'->>'frameSequence')::int<>frames+1
     OR p->'events'->0->>'previous_hash' IS DISTINCT FROM prev
     OR p->'events'->1->>'previous_hash' IS DISTINCT FROM p->'events'->0->>'body_hash'
     THEN RAISE EXCEPTION 'Later append lost its command check or frame'; END IF;
   END $$;
   SELECT ${rpc("finish_step", { stepId: id.step, receipt, receiptHash: chatHash(canonicalChat(receipt)) })};
   DO $$ DECLARE p jsonb; replay jsonb; ev jsonb; after_seq bigint:=0; prev text; BEGIN
    p:=${read(String(total + 2))};
    IF jsonb_array_length(p->'events')<>3 OR (SELECT jsonb_agg(value->>'kind' ORDER BY ordinality) FROM jsonb_array_elements(p->'events') WITH ORDINALITY)
     IS DISTINCT FROM '["scope_checked","model_terminal","completed"]'::jsonb THEN RAISE EXCEPTION 'Terminal command event count differs'; END IF;
    LOOP
     p:=${read("after_seq")}; replay:=${read("after_seq")};
     IF p IS DISTINCT FROM replay OR p->>'state'<>'succeeded' THEN RAISE EXCEPTION 'Terminal replay changed or lost succeeded state'; END IF;
     EXIT WHEN jsonb_array_length(p->'events')=0;
     FOR ev IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
      IF (ev->>'sequence')::bigint<>after_seq+1 OR ev->>'previous_hash' IS DISTINCT FROM prev THEN RAISE EXCEPTION 'Reconnect chain differs'; END IF;
      after_seq:=(ev->>'sequence')::bigint; prev:=ev->>'body_hash';
     END LOOP;
     IF (p->>'cursor')::bigint<>after_seq THEN RAISE EXCEPTION 'Terminal page cursor skipped events'; END IF;
    END LOOP;
    IF after_seq<>${total + 5} OR (p->>'cursor')::bigint<>after_seq THEN RAISE EXCEPTION 'Reconnect lost terminal events'; END IF;
    PERFORM set_config('openplan.fixture.last_page',p::text,true);
   END $$;
   RESET ROLE; DO $$ DECLARE reads int; releases int; BEGIN
    SELECT count(*) INTO reads FROM public.assistant_chat_access_checks WHERE turn_id='${id.turn}' AND purpose='read';
    SELECT count(*) INTO releases FROM public.assistant_chat_access_checks WHERE turn_id='${id.turn}' AND purpose='transcript_replay';
    IF reads=0 OR reads<>releases THEN RAISE EXCEPTION 'Read access/release audit missing'; END IF;
    IF EXISTS(SELECT 1 FROM public.assistant_chat_access_checks a JOIN public.assistant_chat_turns t ON t.id=a.turn_id JOIN public.assistant_chat_grants g ON g.id=t.grant_id
     WHERE a.turn_id='${id.turn}' AND a.purpose='read' AND (a.owner_user_id<>t.owner_user_id OR a.workspace_id<>t.workspace_id OR a.attempt_id<>t.attempt_id
      OR a.grant_digest<>g.digest OR a.exact_body_hash<>g.digest OR a.dependency_set_hash<>assistant_chat_private.dependencies(t.id) OR a.result<>'allowed'
      OR a.id IS NULL OR a.checked_at<transaction_timestamp())) THEN RAISE EXCEPTION 'Read access audit identity or binding differs'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.assistant_chat_access_checks WHERE turn_id='${id.turn}' AND purpose='transcript_replay'
     AND exact_body_hash=assistant_chat_private.sha(assistant_chat_private.canonical(current_setting('openplan.fixture.last_page')::jsonb))) THEN RAISE EXCEPTION 'Exact released page audit missing'; END IF;
    IF EXISTS(SELECT 1 FROM public.assistant_chat_events WHERE turn_id='${id.turn}' AND kind='scope_checked' AND body->>'purpose' IN ('read','intent_read')) THEN RAISE EXCEPTION 'Observation appended to progress'; END IF;
    IF (SELECT count(*) FROM public.assistant_chat_steps WHERE turn_id='${id.turn}')<>1
     OR (SELECT count(*) FROM public.usage_events WHERE workspace_id='${id.workspace}' AND idempotency_key LIKE 'assistant_chat_dispatch:%')<>1
     OR EXISTS(SELECT 1 FROM public.assistant_action_approvals WHERE workspace_id='${id.workspace}')
     OR EXISTS(SELECT 1 FROM public.assistant_action_executions WHERE workspace_id='${id.workspace}') THEN RAISE EXCEPTION 'Pagination or parity replay added an effect'; END IF;
   END $$;`);
 });
 it("matches JS trim, UTF-16 length, UTF-8 bytes and hashes across lossless strings", () => {
  const whitespace = "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const values = ["", `${whitespace}Draft${whitespace}`, "\u0085Draft\u0085", "\u0000", "\u0000\u0000", "😀\u0000x", "literal \\u0000", "$openplan_chat_nul_v1", "Line 1\nLine 2\tend\b\f\rinside"];
  exercise(() => `RESET ROLE;
   ${values.map(value => `DO $$ DECLARE v jsonb:=assistant_chat_private.lossless(${literal(canonicalChat(value))}::json); BEGIN
    IF assistant_chat_private.canonical(v) IS DISTINCT FROM ${literal(canonicalChat(value))}
     OR assistant_chat_private.canonical(assistant_chat_private.trim_string(v)) IS DISTINCT FROM ${literal(canonicalChat(value.trim()))}
     OR assistant_chat_private.string_length(v)<>${value.length} OR assistant_chat_private.string_bytes(v)<>${Buffer.byteLength(value)}
     OR assistant_chat_private.string_hash(v) IS DISTINCT FROM '${chatHash(value)}' THEN RAISE EXCEPTION 'Lossless string vector mismatch'; END IF;
   END $$;`).join("\n")}
   DO $$ BEGIN
    BEGIN PERFORM assistant_chat_private.lossless('{"a":1,"\\u0061":2}'::json); RAISE EXCEPTION 'Duplicate escaped key accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    BEGIN PERFORM assistant_chat_private.lossless('{"$openplan_chat_nul_v1":["",""]}'::json); RAISE EXCEPTION 'Forged storage node accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    BEGIN PERFORM assistant_chat_private.lossless('{"\\u0024openplan_chat_nul_v1":["",""]}'::json); RAISE EXCEPTION 'Escaped storage key accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    BEGIN PERFORM assistant_chat_private.lossless('"\\ud800"'::json); RAISE EXCEPTION 'Lone surrogate accepted'; EXCEPTION WHEN SQLSTATE '22P02' THEN NULL; END;
   END $$;`);
 });
 it.each(["Plain question", "\u0000", "a\u0000\u0000b", "literal \\u0000", "$openplan_chat_nul_v1", "\ue000😀\n\u0000\t"])("prepares, accepts and reads exact question %j without a jsonb NUL cast", question => {
  const grant = chatFixture(); grant.packet.question = question;
  const output = exercise(() => `SELECT 'CHAT_LOSSLESS:'||((public.assistant_chat_session('read','${id.turn}','{}')->>'canonicalResult')::json)::text;`, grant);
  const record = JSON.parse(output.split("\n").find(line => line.startsWith("CHAT_LOSSLESS:"))!.slice("CHAT_LOSSLESS:".length));
  expect(record.released).toBe(true); expect(record.state).toBe("running");
  expect(record.canonical).toBe(canonicalChat(grant)); expect(record.digest).toBe(chatGrantDigest(grant));
  expect(JSON.parse(record.canonical).packet.question).toBe(question);
  expect(record.digest).toBe(chatHash("OpenPlan.AssistantChatGrant.v1\n" + record.canonical));
 });
 it("retains NUL-bearing partial and terminal text with exact hashes and no private storage nodes in RPC output", () => {
  const text = "a\u0000\u0000😀\n\tend", raw = frame({ role: "assistant", content: text }, "stop") + "data: [DONE]\n\n";
  const receipt = checkChatStream(raw, "synthetic-model", []), receiptHash = chatHash(canonicalChat(receipt));
  const output = exercise(rpc => `SELECT ${dispatch(1, id.step)};
   SELECT ${rpc("progress", { stepId: id.step, frameSequence: 1, text })};
   SELECT ${rpc("finish_step", { stepId: id.step, receipt, receiptHash })};
   SELECT 'CHAT_LOSSLESS:'||((public.assistant_chat_session('read','${id.turn}','{}')->>'canonicalResult')::json)::text;`);
  const record = JSON.parse(output.split("\n").find(line => line.startsWith("CHAT_LOSSLESS:"))!.slice("CHAT_LOSSLESS:".length));
  expect(record.state).toBe("succeeded"); expect(record.steps[0].receipt).toEqual(receipt);
  expect(record.steps[0].receipt_hash).toBe(receiptHash);
  const delta = record.events.find((e: { kind: string }) => e.kind === "text_delta");
  expect(delta.body.text).toBe(text); expect(delta.body_hash).toBe(chatHash(canonicalChat(delta.body)));
  expect(JSON.stringify(record)).not.toContain("$openplan_chat_nul_v1");
 });
 it("retains a NUL-bearing draft exactly and refuses original business storage before approval insertion", async () => {
  const input = { projectId: id.project, title: "Draft\u0000title", submittalType: "other" as const, notes: "Notes\u0000end" };
  const raw = frame({ role: "assistant", tool_calls: [{ index: 0, id: "nul_draft", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n";
  const receipt = checkChatStream(raw, "synthetic-model", ["propose_create_project_record"]);
  const grant = chatFixture(), broker = await reservedDraft(grant, receipt.calls[0].input, "nul_draft");
  const executableCanonical = broker.executableCanonical, executableHash = broker.executableHash;
  const action = executableProjectSubmittalAction({ kind: "create_project_record", recordType: "submittal", status: "draft", ...input });
  const output = exercise((rpc, intent) => `SELECT ${dispatch(1, id.step)};
   SELECT ${rpc("finish_step", { stepId: id.step, receipt, receiptHash: chatHash(canonicalChat(receipt)) })};
   DO $$ BEGIN
    PERFORM ((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',pg_temp.chat_first_call()))->>'canonicalResult')::json);
    PERFORM ((public.assistant_chat_session('finish_tool','${id.turn}',jsonb_build_object('callId',pg_temp.chat_first_call(),'handle',pg_temp.chat_first_handle(),'executableCanonical',${literal(executableCanonical)},'envelopes','[]'::jsonb,
     'result',${literal(canonicalChat(broker.result))}::jsonb))->>'canonicalResult')::json);
   END $$;
   SELECT ${dispatch(2, id.request)}; SELECT ${terminal(rpc, id.request, [])};
   DO $$ BEGIN
    BEGIN PERFORM ${intent("issue", { expectedExecutableHash: executableHash, expectedGrantDigest: chatGrantDigest(grant), executableCanonical, approvalRequestId: id.prepare, approvalId: id.accept, expiresAt: new Date(Date.now() + 60000).toISOString(), executionContext: { version: 1, action, project: { id: id.project, workspaceId: id.workspace, name: "Synthetic selected project" } } })};
     RAISE EXCEPTION 'NUL draft minted original approval';
    EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'chat_action_storage_unavailable' THEN RAISE; END IF; END;
    IF ((public.assistant_chat_intent('status','${broker.intentId}','{}')->>'canonicalResult')::json)->>'originalApprovalId' IS NOT NULL THEN RAISE EXCEPTION 'Refused draft retained an approval'; END IF;
   END $$;
   SELECT 'CHAT_LOSSLESS:'||((public.assistant_chat_session('read','${id.turn}','{}')->>'canonicalResult')::json)::text;
   RESET ROLE; DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.assistant_action_approvals WHERE id='${id.accept}') THEN RAISE EXCEPTION 'Refused draft created a detached approval'; END IF; END $$;`, grant, broker.intentId);
  const record = JSON.parse(output.split("\n").find(line => line.startsWith("CHAT_LOSSLESS:"))!.slice("CHAT_LOSSLESS:".length));
  expect(record.calls[0].input).toEqual(input); expect(record.intents).toHaveLength(1);
  expect(record.intents[0].executable_canonical).toBe(executableCanonical); expect(record.intents[0].executable_hash).toBe(executableHash);
  expect(record.intents[0].original_approval_id).toBeNull();
 });
 it.each([
  ...["", "  ", "\t\n", "\u00a0\ufeff", "\u2003\u2028"].map(padding => ({ padding, submittalType: "other" as const, notes: "Notes" })),
  { padding: "", submittalType: "other" as const, notes: "" },
  { padding: "", submittalType: "progress_report" as const, notes: "Line 1\nLine 2\tend" },
 ])("retains actual SDK draft and second request after SQL normalization %j", async ({ padding, submittalType, notes }) => {
  const grant = chatFixture(), input = { projectId: id.project, title: `${padding}Draft${padding}`, submittalType, notes: `${padding}${notes}${padding}` };
  vi.stubEnv("OPENPLAN_INSTALLATION_ID", id.installation); vi.stubEnv("OPENPLAN_CHAT_POOL_ID", id.pool); vi.stubEnv("OPENPLAN_CHAT_POOL_REVISION", id.poolRevision);
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { revision_id: id.revision, connection_id: id.connection, workspace_id: id.workspace, credential_ciphertext: null }, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); sdk.service.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  const raw = frame({ role: "assistant", tool_calls: [{ index: 0, id: "actual_sdk_draft", type: "function", function: { name: "propose_create_project_record", arguments: JSON.stringify(input) } }] }, "tool_calls") + "data: [DONE]\n\n";
  sdk.network.mockResolvedValue(raw); let request = "";
  const messages: ChatWireMessage[] = [{ role: "system", content: CHAT_INSTRUCTIONS }, { role: "user", content: canonicalChat({ question: grant.packet.question, target: grant.scope.target, history: [], sources: grant.packet.initialEnvelopes.map(e => ({ envelopeId: e.envelopeId, dataClass: e.dataClass, capturedAt: e.capturedAt, content: JSON.parse(e.canonicalProjectedContent), omissions: e.omissions, truncation: e.truncation })) }) }];
  const step = await runChatModelStep({ grant, expectedGrantDigest: chatGrantDigest(grant), leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal,
   messages, authorize: async bytes => { request = bytes; } });
  expect(step.receipt.rawBody).toBe(raw); expect(sdk.network).toHaveBeenCalledOnce();
  const call = step.receipt.calls[0], broker = await reservedDraft(grant, call.input, call.toolCallId);
  const executableCanonical = broker.executableCanonical, executableHash = broker.executableHash;
  const nextMessages: ChatWireMessage[] = [...messages, { role: "assistant", content: null, tool_calls: [{ id: call.toolCallId, type: "function", function: { name: call.name, arguments: call.argumentsCanonical } }] },
   { role: "tool", tool_call_id: call.toolCallId, content: canonicalChat(broker.result) }];
  sdk.network.mockResolvedValue(frame({ role: "assistant", content: "Synthetic complete answer" }, "stop") + "data: [DONE]\n\n");
  let secondRequest = "";
  const second = await runChatModelStep({ grant, expectedGrantDigest: chatGrantDigest(grant), leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), signal: new AbortController().signal,
   messages: nextMessages, authorize: async bytes => { secondRequest = bytes; } });
  expect(sdk.network).toHaveBeenCalledTimes(2);
  expect(JSON.parse(JSON.parse(secondRequest).messages[2].tool_calls[0].function.arguments)).toEqual(call.input);
  const wrongRequests = ["value", "id", "duplicate"].map(fault => {
   const wrong = JSON.parse(secondRequest), c = wrong.messages[2].tool_calls[0];
   if (fault === "id") c.id = "changed_id";
   else c.function.arguments = fault === "duplicate" ? '{"notes":"a","notes":"b"}' : JSON.stringify({ ...chatDraftSchema.parse(call.input), notes: "Changed nested value" });
   return JSON.stringify(wrong);
  });
  exercise(rpc => `SELECT ${rpc("dispatch", { sequence: 1, stepId: id.step, request })};
   SELECT ${rpc("finish_step", { stepId: id.step, receipt: step.receipt, receiptHash: step.receiptHash })};
   DO $$ DECLARE c jsonb; r jsonb; BEGIN
    c:=((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',${rpc("read")}->'calls'->0->>'id'))->>'canonicalResult')::json);
    r:=((public.assistant_chat_session('finish_tool','${id.turn}',jsonb_build_object('callId',c->>'callId','handle',c->>'handle','executableCanonical',${literal(executableCanonical)},'envelopes','[]'::jsonb,
     'result',${literal(canonicalChat(broker.result))}::jsonb))->>'canonicalResult')::json);
    IF r->>'released' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Actual SDK draft was not retained'; END IF;
    r:=${rpc("read")};
    IF jsonb_array_length(r->'intents')<>1 OR r->'intents'->0->>'executable_canonical' IS DISTINCT FROM ${literal(executableCanonical)}
     OR r->'intents'->0->>'executable_hash' IS DISTINCT FROM '${executableHash}' OR r->'intents'->0->>'original_approval_id' IS NOT NULL
     THEN RAISE EXCEPTION 'Actual SDK intent identity mismatch'; END IF;
   END $$;
   ${wrongRequests.map(request => `DO $$ BEGIN
    BEGIN PERFORM ${rpc("dispatch", { sequence: 2, stepId: id.request, request })}; RAISE EXCEPTION 'Changed nested argument or identity admitted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
   END $$;`).join("\n")}
   SELECT ${rpc("dispatch", { sequence: 2, stepId: id.request, request: secondRequest })};
   SELECT ${rpc("finish_step", { stepId: id.request, receipt: second.receipt, receiptHash: second.receiptHash })};
   RESET ROLE; DO $$ BEGIN
    IF (SELECT request_canonical FROM public.assistant_chat_steps WHERE id='${id.request}') IS DISTINCT FROM ${literal(secondRequest)}
     OR (SELECT request_hash FROM public.assistant_chat_steps WHERE id='${id.request}') IS DISTINCT FROM '${chatHash(secondRequest)}' THEN RAISE EXCEPTION 'Actual second SDK request bytes changed'; END IF;
   END $$;`, grant, broker.intentId);
 });
 it("denies direct bodies and service issuance, and preserves owner-minimal revocation metadata", () => exercise((rpc) => `
  DO $$ BEGIN
   BEGIN PERFORM 1 FROM public.assistant_chat_grants; RAISE EXCEPTION 'Direct body read succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   IF ${rpc("metadata")}->>'turnId'<>'${id.turn}' THEN RAISE EXCEPTION 'Owner metadata missing'; END IF;
  END $$;
  RESET ROLE; DELETE FROM public.workspace_members WHERE workspace_id='${id.workspace}' AND user_id='${id.user}'; SET LOCAL ROLE authenticated;
  DO $$ BEGIN
   IF ${rpc("read")}->>'released' IS DISTINCT FROM 'false' OR ${rpc("metadata")}->>'state'<>'access_lost' THEN RAISE EXCEPTION 'Revoked body escaped'; END IF;
  END $$;
  RESET ROLE; SET LOCAL ROLE service_role;
  DO $$ BEGIN
   BEGIN PERFORM ${rpc("read")}; RAISE EXCEPTION 'Service impersonated source session'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN PERFORM ((public.assistant_chat_intent('issue','${id.call}','{}')->>'canonicalResult')::json); RAISE EXCEPTION 'Service minted human approval'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END $$;`));
 it("executes the twelfth reserved tool once, refuses a thirteenth, and meters one model dispatch", () => exercise(rpc => {
  const stepId = randomUUID(), nextStep = randomUUID(), envelope = chatFixture().packet.initialEnvelopes[1];
  const calls = Array.from({ length: 12 }, (_, i) => ({ name: "get_surface_context", input: { kind: "project", id: id.project }, id: `call_${i + 1}` }));
  return `SELECT ${dispatch(1, stepId)}; SELECT ${terminal(rpc, stepId, calls)};
   DO $$ DECLARE c jsonb; row jsonb; done jsonb; again jsonb; count_tools int:=0; BEGIN
    FOR row IN SELECT value FROM jsonb_array_elements(${rpc("read")}->'calls') LOOP
     c:=((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',row->>'id'))->>'canonicalResult')::json);
     IF c->>'cached'<>'false' OR (c->>'usedCalls')::int<>12 THEN RAISE EXCEPTION 'Current reservation double counted'; END IF;
     done:=((public.assistant_chat_session('finish_tool','${id.turn}',jsonb_build_object('callId',row->>'id','handle',c->>'handle','result',jsonb_build_object('envelope',${literal(JSON.stringify(envelope))}::jsonb),'envelopes',jsonb_build_array(${literal(JSON.stringify(envelope))}::jsonb)))->>'canonicalResult')::json);
     again:=((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',row->>'id'))->>'canonicalResult')::json);
     IF done->>'released'<>'true' OR again->>'cached'<>'true' THEN RAISE EXCEPTION 'Completed tool replay executed again'; END IF; count_tools:=count_tools+1;
    END LOOP;
    IF count_tools<>12 THEN RAISE EXCEPTION 'Twelfth tool failed to execute'; END IF;
   END $$;
   SELECT ${dispatch(2, nextStep)};
   DO $$ BEGIN BEGIN PERFORM ${terminal(rpc, nextStep, [{ name: "get_surface_context", input: { kind: "project", id: id.project }, id: "call_13" }])}; RAISE EXCEPTION 'Thirteenth tool admitted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END; END $$;
   RESET ROLE; DO $$ BEGIN
    IF (SELECT count(*) FROM public.assistant_chat_tool_calls WHERE turn_id='${id.turn}')<>12 THEN RAISE EXCEPTION 'Tool ledger count changed'; END IF;
    IF (SELECT count(*) FROM public.usage_events WHERE workspace_id='${id.workspace}' AND idempotency_key LIKE 'assistant_chat_dispatch:%')<>2 THEN RAISE EXCEPTION 'Model reservation duplicated or missing'; END IF;
   END $$;`;
 }));
 it("bounds six separately retained invocations including a tool-bearing sixth response", () => exercise(rpc => {
  const envelope = chatFixture().packet.initialEnvelopes[1];
  let sql = "";
  for (let sequence = 1; sequence <= 6; sequence++) {
   const stepId = randomUUID();
   sql += `SELECT ${dispatch(sequence, stepId)}; SELECT ${terminal(rpc, stepId, [{ name: "get_surface_context", input: { kind: "project", id: id.project }, id: `step_call_${sequence}` }])};`;
   if (sequence < 6) sql += `DO $$ DECLARE c jsonb; BEGIN
    c:=((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',(SELECT v->>'id' FROM jsonb_array_elements(${rpc("read")}->'calls') v WHERE v->>'call_id'='step_call_${sequence}')))->>'canonicalResult')::json);
    PERFORM ((public.assistant_chat_session('finish_tool','${id.turn}',jsonb_build_object('callId',c->>'callId','handle',c->>'handle','result',jsonb_build_object('envelope',${literal(JSON.stringify(envelope))}::jsonb),'envelopes',jsonb_build_array(${literal(JSON.stringify(envelope))}::jsonb)))->>'canonicalResult')::json);
   END $$;`;
  }
  // Check the sixth terminal before probing dispatch with its retained request.
  // Building another transcript would reject the deliberately unfinished tool.
  sql += `RESET ROLE; DO $$ DECLARE retained_request text; BEGIN
    IF (SELECT model_steps FROM public.assistant_chat_turns WHERE id='${id.turn}')<>6 OR (SELECT count(*) FROM public.assistant_chat_steps WHERE turn_id='${id.turn}')<>6 THEN RAISE EXCEPTION 'Model-step count is not six'; END IF;
    IF (SELECT state FROM public.assistant_chat_turns WHERE id='${id.turn}')<>'interrupted' THEN RAISE EXCEPTION 'Tool-bearing sixth response became success'; END IF;
    SELECT request_canonical INTO STRICT retained_request FROM public.assistant_chat_steps WHERE turn_id='${id.turn}' AND sequence=6;
    SET LOCAL ROLE authenticated;
    IF ((public.assistant_chat_session('dispatch','${id.turn}',jsonb_build_object('sequence',7,'stepId','${randomUUID()}','request',retained_request))->>'canonicalResult')::json)->>'released' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Seventh invocation admitted'; END IF;
    RESET ROLE;
    IF (SELECT model_steps FROM public.assistant_chat_turns WHERE id='${id.turn}')<>6 OR (SELECT count(*) FROM public.assistant_chat_steps WHERE turn_id='${id.turn}')<>6 THEN RAISE EXCEPTION 'Model-step count is not six'; END IF;
    IF (SELECT state FROM public.assistant_chat_turns WHERE id='${id.turn}')<>'interrupted' THEN RAISE EXCEPTION 'Tool-bearing sixth response became success'; END IF;
   END $$;`;
  return sql;
 }));
 it.each([{ submittalType: "other", notes: "" }, { submittalType: "progress_report", notes: "Line 1\nLine 2\tend" }])("retains one original approval and receipt after move/viewer downgrade %j", async fields => {
  const grant = chatFixture();
  const draft = { projectId: id.project, title: "Synthetic draft", ...fields };
  const broker = await reservedDraft(grant, draft, "proposal_1");
  const output = exercise((rpc, intent) => {
  const stepId = randomUUID(), finalStep = randomUUID(), approvalId = randomUUID();
  const actionCanonical = broker.executableCanonical, hash = broker.executableHash;
  return `SELECT ${dispatch(1, stepId)}; SELECT ${terminal(rpc, stepId, [{ name: "propose_create_project_record", input: draft, id: "proposal_1" }])};
   DO $$ DECLARE c jsonb; BEGIN
    c:=((public.assistant_chat_session('claim_tool','${id.turn}',jsonb_build_object('callId',(${rpc("read")}->'calls'->0->>'id')))->>'canonicalResult')::json);
    PERFORM ((public.assistant_chat_session('finish_tool','${id.turn}',jsonb_build_object('callId',c->>'callId','handle',c->>'handle','result',${literal(canonicalChat(broker.result))}::jsonb,
     'envelopes','[]'::jsonb,'executableCanonical',${literal(actionCanonical)}))->>'canonicalResult')::json);
   END $$;
   SELECT ${dispatch(2, finalStep)}; SELECT ${terminal(rpc, finalStep, [])};
   DO $$ DECLARE bound jsonb; g text; issued jsonb; again jsonb; claim jsonb; BEGIN
    g:=${rpc("read")}->>'digest';
    bound:=jsonb_build_object('approvalRequestId','${id.request}','expectedGrantDigest',g,'expectedExecutableHash','${hash}','executableCanonical',${literal(actionCanonical)},'approvalId','${approvalId}',
     'expiresAt',to_char((clock_timestamp()+interval '4 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'executionContext',jsonb_build_object('version',1,'action',${literal(actionCanonical)}::jsonb,'project',jsonb_build_object('id','${id.project}','workspaceId','${id.workspace}','name','Synthetic selected project')));
    issued:=((public.assistant_chat_intent('issue','${broker.intentId}',bound)->>'canonicalResult')::json);
    again:=((public.assistant_chat_intent('issue','${broker.intentId}',bound||jsonb_build_object('approvalRequestId','${id.prepare}','approvalId','${randomUUID()}'))->>'canonicalResult')::json);
    IF issued->>'approvalId'<>'${approvalId}' OR again->>'approvalId'<>issued->>'approvalId' OR again->>'replayed'<>'true' THEN RAISE EXCEPTION 'Lost reply reminted approval'; END IF;
    claim:=${intent("claim_execution", { originalApprovalId: approvalId, expectedExecutableHash: hash })};
    IF claim->>'dispatch'<>'true' OR ${intent("claim_execution", { originalApprovalId: approvalId, expectedExecutableHash: hash })}->>'dispatch'<>'false' THEN RAISE EXCEPTION 'Execution claim replayed'; END IF;
   END $$;
   ${directRlsBoundaries(approvalId, broker.intentId)}
   RESET ROLE; SELECT public.record_assistant_project_submittal('${approvalId}','${id.user}','${id.workspace}',${literal(actionCanonical)});
   UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='${id.workspace}' AND user_id='${id.user}'; UPDATE public.projects SET workspace_id='${id.pool}' WHERE id='${id.project}';
   SET LOCAL ROLE authenticated;
   DO $$ BEGIN
    IF ${rpc("read")}->>'released'<>'false' THEN RAISE EXCEPTION 'Moved source replayed'; END IF;
    IF ${intent("reconcile")}->>'receiptState'<>'present_verified' OR ${intent("status")}->>'originalApprovalId'<>'${approvalId}' THEN RAISE EXCEPTION 'Original result not recovered'; END IF;
   END $$;
   RESET ROLE; DO $$ BEGIN IF (SELECT count(*) FROM public.assistant_action_approvals WHERE id='${approvalId}')<>1 THEN RAISE EXCEPTION 'Approval association changed'; END IF; END $$;`;
 }, grant, broker.intentId);
  expect(output).toContain("CHAT_DIRECT_RLS_ASSERTIONS_REACHED:60:4");
 });
});
