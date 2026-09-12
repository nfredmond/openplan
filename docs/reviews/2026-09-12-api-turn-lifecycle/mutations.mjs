import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const review = fileURLToPath(new URL(".", import.meta.url));
const app = resolve(review, "../../../openplan");
const workdir = process.env.OPENPLAN_SUPABASE_WORKDIR;
if (!workdir || !isAbsolute(workdir)) throw new Error("Name the isolated Supabase stack explicitly.");
const source = readFileSync(join(app, "supabase/migrations/20261012000002_assistant_api_turns.sql"), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "openplan-api-turn-mutations-"));
function definition(name) {
  const start = source.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`));
  const end = source.indexOf("\nEND $$;", start);
  if (start < 0 || end < 0) throw new Error(`Missing function ${name}`);
  return source.slice(start, end + "\nEND $$;".length).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
}
function change(name, before, after, all = false) {
  const sql = definition(name);
  if (!sql.includes(before) || (!all && sql.split(before).length !== 2)) throw new Error(`Ambiguous mutation ${name}: ${before}`);
  return all ? sql.replaceAll(before, after) : sql.replace(before, after);
}
const expiredRequeue = change("claim_assistant_api_turn", "IF job.state<>'queued' THEN RETURN NULL; END IF;", "IF job.state='interrupted' THEN UPDATE public.assistant_provider_turns SET state='queued',attempt_id=NULL,lease_expires_at=NULL,finished_at=NULL,failure_code=NULL,started_at=NULL WHERE id=job.id RETURNING * INTO job; END IF;\n  IF job.state<>'queued' THEN RETURN NULL; END IF;");
const cases = [
  ["harmless-comment", "-- Deliberate harmless control\nSELECT 1;", null],
  ["create-scope", change("create_assistant_api_turn", "PERFORM public.assert_assistant_provider_scope(p_user_id,p_workspace_id,p_project_id);", "PERFORM 1;"), "Foreign author created work"],
  ["charge-ack", change("create_assistant_api_turn", "IF p_charge_ack IS DISTINCT FROM true THEN", "IF false THEN"), "Missing acknowledgement accepted"],
  ["changed-request", change("create_assistant_api_turn", "IF job.request_hash IS DISTINCT FROM request_digest THEN", "IF false THEN", true), "Changed request accepted"],
  ["stale-selection", change("create_assistant_api_turn", "IF connection.revoked_at IS NOT NULL OR connection.current_revision_id IS DISTINCT FROM revision.id THEN", "IF false THEN"), "New request used stale revision"],
  ["immutable-request", change("preserve_assistant_api_turn_identity", "(OLD.provider='api_connection' OR NEW.provider='api_connection')", "false"), "Question rewritten"],
  ["edit-interruption", change("interrupt_changed_assistant_api_connection", "IF OLD.current_revision_id IS DISTINCT FROM NEW.current_revision_id OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN", "IF false THEN"), "Old active attempts survived correction"],
  ["current-scope", change("lock_assistant_api_turn", "PERFORM public.assert_assistant_provider_scope(identity.user_id,identity.workspace_id,identity.project_id);", "PERFORM 1;"), "Removed author received an answer"],
  ["lease-expiry", change("lock_assistant_api_turn", "ELSIF job.state='running' AND job.lease_expires_at<=clock_timestamp() THEN", "ELSIF false THEN"), "Expiry was not durable"],
  ["expired-requeue-blocked-by-ledger", expiredRequeue, "usage_events_idempotency_key_key"],
  ["expired-requeue-new-reservation", expiredRequeue.replace("\'assistant_api_dispatch:\'||job.id::text,", "\'assistant_api_dispatch:\'||job.id::text||\':\'||job.attempt_id::text,"), "Lost process was reclaimed"],
  ["dispatch-cap", change("claim_assistant_api_turn", "IF recent_count>=20 THEN", "IF false THEN"), "Dispatch cap allowed excess work"],
  ["dispatch-reservation", change("claim_assistant_api_turn", "  INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)\n    VALUES(job.workspace_id,job.id::text,'assistant_chat',1,'assistant_api_dispatch:'||job.id::text,\n      '/api/assistant/providers/turns',jsonb_build_object('provider','api_connection','dispatchReservation',true));", "  PERFORM 1;"), "Dispatch reservation missing or repeated"],
  ["status-attempt", change("read_assistant_api_turn_status", "identity.attempt_id IS DISTINCT FROM p_attempt_id", "false"), "Foreign attempt obtained status"],
  ["access-loss-retirement", change("read_assistant_api_turn_status", "WHERE id=identity.id AND state IN ('queued','running');", "WHERE false;"), "Lost access was not durable"],
  ["changed-completion", change("finish_assistant_provider_turn", "IF job.result IS DISTINCT FROM p_result OR job.provider_receipt IS DISTINCT FROM p_provider_receipt OR job.failure_code IS DISTINCT FROM p_failure_code THEN", "IF false THEN"), "Changed completion accepted"],
  ...Object.entries({ turnId: "job.id::text", attemptId: "job.attempt_id::text", connectionId: "job.api_connection_id::text", revisionId: "job.api_revision_id::text",
    configurationHash: "job.api_configuration_hash", packetHash: "job.packet_hash", endpoint: "job.api_configuration_canonical::jsonb->>'endpoint'", protocol: "job.api_configuration_canonical::jsonb->>'protocol'" }).map(([field, expression]) => [
    `receipt-${field}`, change("finish_assistant_provider_turn", `p_provider_receipt->>'${field}' IS DISTINCT FROM ${expression}`, "false"), `Mismatched receipt accepted: ${field}`,
  ]),
  ["ordinary-worker-status", "GRANT EXECUTE ON FUNCTION public.read_assistant_api_turn_status(uuid,uuid) TO authenticated;", "Member used worker status"],
  ["ordinary-create", "GRANT EXECUTE ON FUNCTION public.create_assistant_api_turn(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,text,text) TO authenticated;", "Member impersonated an author"],
  ["revision-foreign-key", "ALTER TABLE public.assistant_provider_turns DROP CONSTRAINT assistant_api_revision_identity;", "Cross-workspace revision reference accepted"],
  ["snapshot-hash", "ALTER TABLE public.assistant_provider_turns DROP CONSTRAINT assistant_api_snapshot;", "Canonical snapshot hash mismatch accepted"],
];
const results = [];
for (const [name, sql, expectedFailure] of cases) {
  const mutation = join(scratch, `${name}.sql`), output = join(scratch, `${name}.json`);
  writeFileSync(mutation, sql);
  const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/test/assistant-api-turns-rls.test.ts", "--reporter=json", `--outputFile=${output}`], {
    cwd: app, env: { ...process.env, OPENPLAN_RLS_LIVE_TEST: "1", OPENPLAN_API_TURN_MUTATION_SQL: mutation }, encoding: "utf8", timeout: 60_000,
  });
  const report = JSON.parse(readFileSync(output, "utf8"));
  const failures = report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === "failed").map(test => ({ name: test.fullName, message: test.failureMessages.join("\n") })));
  if (report.numTotalTests !== 16 || (run.status !== 0 && failures.length === 0)) throw new Error(`Invalid execution ${name}`);
  const outcome = run.status === 0 ? "survived" : "killed";
  const matched = expectedFailure === null ? outcome === "survived" : outcome === "killed" && failures.some(test => test.message.includes(expectedFailure));
  results.push({ name, outcome, expectedFailure, matched, failures });
  writeFileSync(join(review, "mutations.json"), JSON.stringify(results, null, 2) + "\n");
  process.stdout.write(`${name}: ${outcome}${matched ? "" : " UNEXPECTED"}\n`);
  if (!matched) process.exitCode = 1;
}
