import { execFileSync } from "node:child_process";
import { expect } from "vitest";
import { requireContractVerificationStack } from "./contract-verification-stack";

const helper = "public.check_synthesis_thematic_review_import(uuid,uuid,uuid,text,jsonb,jsonb)";
const writer = "public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text)";
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** These probes use the real original proposal retained by the HTTP journey.
 * Every fixture write and function mutation rolls back in its own transaction.
 * They prove native custody checks, not thematic semantic quality or UI use.
 */
export function verifyThematicImportNativeGuards(container: string, importId: string) {
  requireContractVerificationStack(container);
  const cases = [
    { name: "reference shape", message: "Invalid thematic proposal reference", code: "22023",
      change: "reference:=reference||'{\"extra\":true}'::jsonb;", rebind: true },
    { name: "integer selection sequence", message: "Invalid thematic proposal sequence", code: "22023",
      change: `WITH next AS (SELECT gen_random_uuid() AS id, max(sequence_no)+1 AS sequence FROM engagement_synthesis_generation_selections
          WHERE request_id=(reference->>'requestId')::uuid), previous AS (SELECT * FROM engagement_synthesis_generation_selections
          WHERE request_id=(reference->>'requestId')::uuid ORDER BY sequence_no DESC LIMIT 1)
        INSERT INTO engagement_synthesis_generation_selections(id,request_id,task_index,attempt_id,previous_selection_id,sequence_no,actor_id,origin,receipt_text)
        SELECT n.id,p.request_id,p.task_index,p.attempt_id,p.id,n.sequence,saved.actor_id,'staff',
          (p.receipt_text::jsonb||jsonb_build_object('id',n.id,'previousSelectionId',p.id,'sequence',n.sequence,'actorId',saved.actor_id,
            'origin','staff','authorizationId',NULL,'reason','SYNTHETIC later selection'))::text FROM next n CROSS JOIN previous p;
        reference:=jsonb_set(reference,'{selectionSequence}',to_jsonb((reference->>'selectionSequence')::numeric+0.5));
        history:=jsonb_set(history,'{throughSequence}',reference->'selectionSequence');`, history: true, rebind: true },
    { name: "original proposal checksum", message: "Original thematic import evidence differs", code: "22023",
      change: "origin:=jsonb_set(origin,'{proposalText}',to_jsonb((origin->>'proposalText')||' '));" },
    { name: "original interpretation", message: "Original thematic import evidence differs", code: "22023",
      change: "origin:=jsonb_set(origin,'{interpretation}','\"staff_reviewed\"');" },
    { name: "request campaign", message: "Thematic import source scope differs", code: "PT409",
      change: "campaign:=gen_random_uuid(); history:=jsonb_set(history,'{campaignId}',to_jsonb(campaign::text));", history: true, rebind: true },
    { name: "retained selection ceiling", message: "Thematic import plan or sequence is unavailable", code: "PT409",
      change: "reference:=jsonb_set(reference,'{selectionSequence}',to_jsonb((SELECT max(sequence_no)+1 FROM engagement_synthesis_generation_selections WHERE request_id=(reference->>'requestId')::uuid))); history:=jsonb_set(history,'{throughSequence}',reference->'selectionSequence');", history: true, rebind: true },
    { name: "final selected capture", message: "Selected thematic final capture differs", code: "PT409",
      change: "reference:=jsonb_set(reference,'{finalCaptureSha256}',to_jsonb(repeat('e',64)));", rebind: true },
    { name: "history plan binding", message: "Thematic proposal history binding differs", code: "22023",
      change: "history:=jsonb_set(history,'{headerSha256}',to_jsonb(repeat('e',64)));", history: true, rebind: true },
  ];
  function mutate(signature: string, message: string) {
    // Locate one complete IF condition using its unique refusal message. The
    // original body is restored by rollback even when the assertion aborts.
    return `DO $mutation$ DECLARE body text; prefix text; marker integer; start_at integer; condition_end integer; BEGIN
      body:=pg_get_functiondef(${literal(signature)}::regprocedure);
      marker:=position(${literal("RAISE EXCEPTION '" + message + "'")} IN body);
      IF marker=0 THEN RAISE EXCEPTION 'Missing native import mutation seam'; END IF;
      prefix:=left(body,marker-1);
      start_at:=length(prefix)-strpos(reverse(prefix),reverse('IF '))-1;
      IF start_at<1 THEN RAISE EXCEPTION 'Missing native import IF'; END IF;
      condition_end:=start_at+strpos(substring(body from start_at),' THEN')+4;
      EXECUTE left(body,start_at-1)||'IF false THEN'||substring(body from condition_end);
    END $mutation$;`;
  }
  function run(change = "", expectedCode?: string, mutation = "", statement?: string) {
    const invoke = statement ?? "PERFORM check_synthesis_thematic_review_import(campaign,root.workspace_id,root.source_id,root.source_sha256,reference,origin);";
    const assertion = expectedCode ? `BEGIN ${invoke} RAISE EXCEPTION 'SYNTHETIC missing import refusal'; EXCEPTION WHEN SQLSTATE '${expectedCode}' THEN NULL; END;`
      : invoke;
    return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
      input: `BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'; ${mutation}
        DO $proof$ DECLARE saved public.engagement_synthesis_review_revisions; root public.engagement_synthesis_reviews;
        current_revision public.engagement_synthesis_review_revisions; reference jsonb; origin jsonb; history jsonb; campaign uuid; content jsonb; command jsonb;
        BEGIN
          SELECT * INTO STRICT saved FROM engagement_synthesis_review_revisions WHERE id=${literal(importId)}::uuid;
          SELECT * INTO STRICT root FROM engagement_synthesis_reviews WHERE id=saved.review_id;
          UPDATE workspace_members SET role='member' WHERE workspace_id=root.workspace_id AND user_id=saved.actor_id;
          SELECT * INTO STRICT current_revision FROM engagement_synthesis_review_revisions WHERE review_id=root.id ORDER BY revision_no DESC LIMIT 1;
          content:=saved.content_text::jsonb; origin:=content->'machineOrigin'; reference:=origin->'reference'; history:=(origin->>'historyText')::jsonb;
          campaign:=root.campaign_id; command:=saved.intent_json;
          ${change}
          ${assertion}
        END $proof$; ROLLBACK; SELECT 'native-import-probe-complete';`,
    }).trim();
  }
  expect(run()).toBe("native-import-probe-complete");
  expect(run("", undefined, "-- Harmless native import control.")).toBe("native-import-probe-complete");
  const oldJsonCheck = `DO $mutation$ DECLARE body text; BEGIN
    body:=pg_get_functiondef('${helper}'::regprocedure);
    EXECUTE replace(body, 'json_typeof((p_origin->>''proposalText'')::json) IS DISTINCT FROM ''object''',
      '(p_origin->>''proposalText'' IS JSON OBJECT WITH UNIQUE KEYS) IS NOT TRUE');
  END $mutation$;`;
  let jsonFailure: unknown;
  try { run("", undefined, oldJsonCheck); } catch (error) { jsonFailure = error; }
  expect(String((jsonFailure as { stderr?: unknown })?.stderr)).toContain("Original thematic import evidence differs");
  for (const probe of cases) {
    let change = probe.change;
    if (probe.history) change += " origin:=jsonb_set(origin,'{historyText}',to_jsonb(history::text)); reference:=jsonb_set(reference,'{historyManifestSha256}',to_jsonb(encode(extensions.digest(history::text,'sha256'),'hex')));";
    if (probe.rebind) change += " origin:=jsonb_set(origin,'{reference}',reference);";
    expect(run(change, probe.code), probe.name).toBe("native-import-probe-complete");
    let failure: unknown;
    try { run(change, probe.code, mutate(helper, probe.message)); } catch (error) { failure = error; }
    expect(String((failure as { stderr?: unknown })?.stderr), probe.name).toContain("SYNTHETIC missing import refusal");
  }
  const retain = "PERFORM retain_engagement_synthesis_review(root.campaign_id,saved.actor_id,root.workspace_id,command,root.source_id,root.source_sha256,NULL,content::text);";
  for (const probe of [
    { name: "stale import parent", message: "Review has a newer revision", code: "PT409",
      change: "command:=jsonb_set(command,'{requestId}',to_jsonb(gen_random_uuid()::text)); content:=jsonb_set(content,'{title}','\"SYNTHETIC different stale draft\"');" },
    { name: "correction preserves machine origin", message: "Correction cannot change original machine evidence", code: "22023",
      change: "command:=(command-'proposal')||jsonb_build_object('operation','correct','requestId',gen_random_uuid(),'expectedRevisionId',current_revision.id,'expectedRevisionSha256',current_revision.content_sha256,'change',jsonb_build_object('kind','notes','title','SYNTHETIC correction','notes','Keep evidence')); content:=content-'machineOrigin';" },
    { name: "ordinary creation refuses machine origin", message: "Creation cannot claim a machine proposal", code: "22023",
      change: "command:=jsonb_build_object('operation','create','requestId',gen_random_uuid(),'actorId',saved.actor_id,'workspaceId',root.workspace_id,'sourceId',root.source_id,'sourceSha256',root.source_sha256);",
      invoke: "PERFORM retain_engagement_synthesis_review(root.campaign_id,saved.actor_id,root.workspace_id,command,root.source_id,root.source_sha256,root.preparation_text,content::text);" },
  ]) {
    expect(run(probe.change, probe.code, "", probe.invoke ?? retain), probe.name).toBe("native-import-probe-complete");
    let failure: unknown;
    try { run(probe.change, probe.code, mutate(writer, probe.message), probe.invoke ?? retain); } catch (error) { failure = error; }
    expect(String((failure as { stderr?: unknown })?.stderr), probe.name).toContain("SYNTHETIC missing import refusal");
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    const check = `IF has_function_privilege('${role}','${helper}','EXECUTE') THEN RAISE EXCEPTION 'SYNTHETIC private import helper callable'; END IF;`;
    expect(run("", undefined, "", check)).toBe("native-import-probe-complete");
    let failure: unknown;
    try { run("", undefined, `GRANT EXECUTE ON FUNCTION ${helper} TO ${role};`, check); } catch (error) { failure = error; }
    expect(String((failure as { stderr?: unknown })?.stderr), role).toContain("SYNTHETIC private import helper callable");
  }
  return cases.length + 7;
}
