// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSynthesisThematicStagingPlan, verifySynthesisThematicStagingState, synthesisThematicStagingStateSchema } from "@/lib/engagement/synthesis-thematic-staging";
import { thematicStagingFixture } from "./fixtures/engagement/synthesis-thematic-staging";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";
import { z } from "zod";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

const migration = readFileSync("supabase/migrations/20261015000008_engagement_synthesis_thematic_plans.sql", "utf8");
const readFixture = (name: string) => readFileSync(`src/test/fixtures/engagement/synthesis-${name}.sql`, "utf8");
const source = readFixture("source-custody");
const requests = readFixture("generation-requests").split("SET LOCAL ROLE authenticated;\nINSERT INTO generation_probe VALUES('original'")[0];
const thematic = readFixture("thematic-requests").split("-- Current staff can read")[0];
const choices = readFixture("thematic-choices").split("SELECT pg_temp.gen_cancel(")[0];
const inputs = readFixture("thematic-inputs").split("SELECT pg_temp.gen_cancel(")[0];
const seals = readFixture("thematic-input-seals");
const helpers = seals.split("DO $$ DECLARE signature")[0];
const complete = seals.slice(seals.indexOf("-- Complete every actual source member"), seals.indexOf("DO $$ DECLARE page jsonb;"));
const fixture = readFixture("thematic-plans");
function nativePlan(mutation = "") {
 const container = resolveLocalDbContainer(); requireContractVerificationStack(container);
 return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
  input: `BEGIN; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';
  ${process.env.OPENPLAN_SYNTHESIS_THEMATIC_PLANS_CANDIDATE === "1" ? migration : ""}
  ${source}\n${requests}\n${thematic}\n${choices}\n${inputs}\nRESET ROLE;\n${helpers}\n${complete}\n${mutation}\n${fixture}\nROLLBACK;`,
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90000, maxBuffer: 16 * 1024 * 1024,
 });
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function change(target: string, old: string, replacement: string) {
 return `DO $fault$ DECLARE body text; BEGIN body=pg_get_functiondef('${target}'::regprocedure);
 IF position(${literal(old)} IN body)=0 THEN RAISE EXCEPTION 'Missing thematic staging mutation seam'; END IF;
 EXECUTE replace(body,${literal(old)},${literal(replacement)}); END $fault$;`;
}
const prepare = "public.prepare_engagement_synthesis_thematic_plan(uuid,text)";
const stage = "public.stage_engagement_synthesis_thematic_frames(uuid,bigint,text,text)";
const seal = "public.seal_engagement_synthesis_thematic_plan(uuid,text)";
const faults: [string,string,string][] = [
 ...[
  "OR (SELECT count(*) FROM jsonb_object_keys(header))<>20",
  "OR header->'schemaVersion' IS DISTINCT FROM '1'::jsonb",
  "OR header->>'purpose' IS DISTINCT FROM 'private_synthesis_thematic_frame_plan'",
  "OR header->>'requestId' IS DISTINCT FROM p_request::text",
  "OR header->'campaignId' IS DISTINCT FROM identity->'campaignId'",
  "OR header->'workspaceId' IS DISTINCT FROM identity->'workspaceId'",
  "OR header->'actorId' IS DISTINCT FROM identity#>'{thematic,request,actorId}'",
  "OR header->'intentSha256' IS DISTINCT FROM identity#>'{thematic,request,intentSha256}'",
  "OR header->'thematicRequestSha256' IS DISTINCT FROM identity#>'{thematic,thematic,thematicSha256}'",
  "OR header->>'recipeId' IS DISTINCT FROM 'openplan.engagement.synthesis.thematic.v1'",
  "OR header->>'recipeSha256' IS DISTINCT FROM '7310c615ecff9ec8d67f498d188321c2bc104cec6020b206481953c7f88eda69'",
  "OR header->'inputManifestSha256' IS DISTINCT FROM identity#>'{seal,manifestSha256}'",
  "OR header->'inputSealSha256' IS DISTINCT FROM identity#>'{seal,receiptSha256}'",
  "OR header->'frameByteLimit' IS DISTINCT FROM binding->'frameByteLimit'",
  "OR header->'taskByteLimit' IS DISTINCT FROM intent->'taskByteLimit'",
  "OR header->>'continuationHeaderSha256' !~ '^[a-f0-9]{64}$'",
  "OR header->>'contentManifestSha256' !~ '^[a-f0-9]{64}$'",
  "OR header->>'tailSha256' !~ '^[a-f0-9]{64}$'",
  "OR (header->>'taskCount')::numeric<>(header->>'frameCount')::numeric+1",
 ].map((condition):[string,string,string]=>[condition,change(prepare,condition,""),"Malformed thematic plan header accepted"]),
 ["header size",change(prepare,"OR octet_length(p_header_text)>8192",""),"Oversized thematic header accepted"],
 ["header uniqueness",change(prepare,"IS NOT JSON OBJECT WITH UNIQUE KEYS","IS NOT JSON OBJECT"),"Duplicate thematic header accepted"],
 ["packet size",change(stage,"OR octet_length(p_frames_text)>4194304",""),"Oversized packet accepted"],
 ["frame size",change(stage,"OR octet_length(frame_text)>(header->>'frameByteLimit')::integer",""),"Individual frame limit bypassed"],
 ["frame chain",change(stage,"||':'||sha||':'||octet_length(frame_text)::text","||':omitted'"),"Thematic plan is incomplete or differs"],
 ["proposal reference",change(seal,"'contentManifestSha256',header->>'contentManifestSha256'","'contentManifestSha256',repeat('0',64)"),"Proposal reference binding differs"],
 ["input seal required",change("public.lock_synthesis_thematic_plan_scope(uuid)","IF identity->'seal'='null'::jsonb THEN","IF false THEN"),"Missing input seal allowed staging"],
 ["header retry",change(prepare,"IF plan.header_text IS DISTINCT FROM p_header_text THEN","IF false THEN"),"Changed plan retry accepted"],
 ["prefix",change(stage,"IF p_previous_sha256 IS DISTINCT FROM expected_previous THEN","IF false THEN"),"Wrong prefix accepted"],
 ["frame retry",change(stage,"IF existing IS DISTINCT FROM entry#>>'{}' THEN","IF false THEN"),"Changed frame retry accepted"],
 ["byte total",change(stage,"IF bytes>(header->>'frameBytes')::bigint THEN","IF false THEN"),"Frame byte ceiling exceeded"],
 ["seal header",change(seal,"IF p_header_sha256 IS DISTINCT FROM state->>'headerSha256' THEN","IF false THEN"),"Wrong header sealed"],
 ["seal bytes",change(seal,"OR state->'frameBytes' IS DISTINCT FROM header->'frameBytes'",""),"Wrong byte total sealed"],
 ["seal tail",change(seal,"OR state->>'tailSha256' IS DISTINCT FROM header->>'tailSha256'",""),"Wrong frame tail sealed"],
 ["cancel prepare",change(prepare,"IF identity#>'{thematic,cancellation}'<>'null'::jsonb THEN","IF false THEN"),"Cancelled request prepared"],
 ["cancel stage",change(stage,"state->>'cancelled'='true' OR ",""),"Cancelled request staged"],
 ["cancel seal",change(seal,"IF state->>'cancelled'='true' THEN","IF false THEN"),"Cancelled complete request sealed"],
 ["frame RLS","ALTER TABLE engagement_synthesis_thematic_frames DISABLE ROW LEVEL SECURITY;","Thematic frame RLS disabled"],
 ["frame immutable","ALTER TABLE engagement_synthesis_thematic_frames DISABLE TRIGGER synthesis_thematic_frame_immutable;","Thematic original update allowed"],
 ["direct write","GRANT INSERT ON engagement_synthesis_thematic_frames TO service_role;","Direct thematic frame mutation allowed"],
 ["client command",`GRANT EXECUTE ON FUNCTION ${prepare} TO authenticated;`,"Client thematic staging command exposed"],
];
describe.skipIf(!LIVE_RLS)("native thematic staging", () => {
 it("preserves bytes, bounded frames, proposal reference, recovery and scope", () => {
  const output=nativePlan(); expect(output).toContain("synthesis-thematic-plan-verified");
  const line=output.split("\n").find(line=>line.startsWith("THEMATIC-PLAN-COMPATIBILITY:"));expect(line).toBeDefined();
  const packet=z.object({state:synthesisThematicStagingStateSchema,frames:z.array(z.string())}).parse(JSON.parse(line!.slice("THEMATIC-PLAN-COMPATIBILITY:".length)));
  const expected=thematicStagingFixture().plan,header=JSON.parse(packet.state.headerText) as typeof expected.header;
  const continuation=expected.continuation;
  Object.assign(continuation.header,header);continuation.headerSha256=header.continuationHeaderSha256;
  Object.assign(continuation.content.request.state,{campaignId:header.campaignId,workspaceId:header.workspaceId});
  continuation.content.manifest.frameByteLimit=header.frameByteLimit;
  continuation.content.frames=packet.frames.map((canonical,index)=>({index,canonical,sha256:hash(canonical),utf8Bytes:Buffer.byteLength(canonical)}));
  const plan=createSynthesisThematicStagingPlan(continuation);expect(plan.header).toEqual(header);
  expect(verifySynthesisThematicStagingState({...plan,headerText:packet.state.headerText,headerSha256:hash(packet.state.headerText)},packet.state)).toEqual(packet.state);
 },90000);
 it("preserves a harmless comment mutation", () => {
  expect(nativePlan(change(stage,"Preserve syntax-valid opaque bytes","Retain syntax-valid opaque bytes"))).toContain("synthesis-thematic-plan-verified");
 },90000);
 it.each(faults)("detects broken %s", (_name,mutation,expected) => {
  let failure: unknown; try { nativePlan(mutation); } catch (error) { failure=error; }
  expect(failure).toBeDefined(); expect(String((failure as {stderr?: unknown}).stderr)).toContain(expected);
 },90000);
});
