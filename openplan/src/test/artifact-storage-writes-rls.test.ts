import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

/**
 * Generated reports and grant application exports are written by the server
 * only (migration 20261017000013), so the workspace storage limit cannot be
 * bypassed with a member's own token.
 *
 * Until that migration, owners, admins and members could insert straight into
 * report-artifacts and grant-application-exports; this probe asserted it. It
 * now asserts the opposite, and keeps every other check it carried:
 *
 * - no workspace role (owner, admin, member, viewer) can insert, change or
 *   delete an object in either bucket, in its own workspace or another one;
 * - every role still reads its own workspace's stored files, and only those;
 * - a removed member loses read access;
 * - the service role, which the two routes now use after checking the limit,
 *   still writes both buckets, and workspace_storage_bytes counts what it wrote;
 * - artifact_storage_writer_insert (20261015000002) still keeps a viewer out
 *   if a member insert policy is ever restored.
 *
 * Native policy checks use rolled-back synthetic rows, never stored file bytes.
 */
function probe(mutation = "") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const actor = randomUUID(), steward = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
  const sql = `BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
${mutation}
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('${actor}','authenticated','authenticated','security-${actor}@example.invalid'),
 ('${steward}','authenticated','authenticated','security-${steward}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES
 ('${workspace}','SYNTHETIC Storage policy','security-${workspace}'),
 ('${foreignWorkspace}','SYNTHETIC foreign Storage policy','security-${foreignWorkspace}');
-- A second owner keeps the workspace owned while the actor changes role and is removed.
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${actor}','owner'),('${workspace}','${steward}','owner');
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_denied(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION '%',label;
END $$;
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('report-artifacts','${workspace}/synthetic/retained.pdf','{"size":1000}'),
 ('grant-application-exports','${workspace}/synthetic/retained.pdf','{"size":2000}'),
 ('report-artifacts','${foreignWorkspace}/synthetic/foreign.pdf','{"size":5}'),
 ('grant-application-exports','${foreignWorkspace}/synthetic/foreign.pdf','{"size":5}');
SELECT set_config('request.jwt.claim.sub','${actor}',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE r text; b text;
BEGIN
 FOREACH r IN ARRAY ARRAY['owner','admin','member','viewer'] LOOP
  UPDATE public.workspace_members SET role=r WHERE workspace_id='${workspace}' AND user_id='${actor}';
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH b IN ARRAY ARRAY['report-artifacts','grant-application-exports'] LOOP
   PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id=b AND name='${workspace}/synthetic/retained.pdf'),
     format('%s lost read access to %s', initcap(r), b));
   PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id=b AND name LIKE '${foreignWorkspace}/%'),
     format('%s read another workspace''s %s', initcap(r), b));
   PERFORM pg_temp.expect_denied(format('INSERT INTO storage.objects(bucket_id,name,metadata) VALUES(%L,%L,%L)', b, '${workspace}/synthetic/'||r||'.pdf', '{"size":1}'),
     format('%s upload to %s was allowed', initcap(r), b));
   PERFORM pg_temp.expect_denied(format('INSERT INTO storage.objects(bucket_id,name) VALUES(%L,%L)', b, '${foreignWorkspace}/synthetic/'||r||'.pdf'),
     format('%s upload to another workspace''s %s was allowed', initcap(r), b));
   -- Whether a change is filtered to no rows or refused outright, the
   -- stored object must come through unchanged; checked below as postgres.
   BEGIN UPDATE storage.objects SET metadata='{"size":0}' WHERE bucket_id=b AND name='${workspace}/synthetic/retained.pdf'; EXCEPTION WHEN OTHERS THEN NULL; END;
   BEGIN DELETE FROM storage.objects WHERE bucket_id=b AND name='${workspace}/synthetic/retained.pdf'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  PERFORM pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('gtfs-uploads','${workspace}/synthetic/member.zip')$q$,
    format('%s upload to an unrelated service-only bucket was allowed', initcap(r)));
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE name='${workspace}/synthetic/retained.pdf'
  AND ((bucket_id='report-artifacts' AND metadata->>'size'='1000') OR (bucket_id='grant-application-exports' AND metadata->>'size'='2000'))),
  'A workspace role changed or removed a stored report or export');
-- Defense in depth: restore a member insert policy and the writer gate must still refuse a viewer.
CREATE POLICY synthetic_restored_member_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id IN ('report-artifacts','grant-application-exports')
  AND split_part(name,'/',1) IN (SELECT workspace_id::text FROM public.workspace_members WHERE user_id=auth.uid()));
UPDATE public.workspace_members SET role='viewer' WHERE workspace_id='${workspace}' AND user_id='${actor}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('report-artifacts','${workspace}/synthetic/gate.pdf')$q$,'Viewer report upload passed the writer gate');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('grant-application-exports','${workspace}/synthetic/gate.pdf')$q$,'Viewer grant upload passed the writer gate');
RESET ROLE;
DROP POLICY synthetic_restored_member_insert ON storage.objects;
DELETE FROM public.workspace_members WHERE workspace_id='${workspace}' AND user_id='${actor}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE name='${workspace}/synthetic/retained.pdf'),'Revoked reader retained access');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('report-artifacts','${workspace}/synthetic/worker.pdf','{"size":300}'),
 ('grant-application-exports','${workspace}/synthetic/worker.pdf','{"size":400}');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE name='${workspace}/synthetic/worker.pdf'),'Service worker upload was removed');
SELECT pg_temp.assert_true(public.workspace_storage_bytes('${workspace}')=3700,'Server-written reports and exports are not counted toward the storage limit');
SELECT 'artifact-storage-policy-verified';
ROLLBACK;`;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 25000,
  });
}

function probeFailure(mutation: string): string {
  let failure: unknown;
  try {
    probe(mutation);
  } catch (error) {
    failure = error;
  }
  expect(failure, "The mutated policy set must fail the probe").toBeDefined();
  return String((failure as { stderr?: unknown }).stderr);
}

/** The member insert policy as it stood before 20261017000013, for one bucket. */
function restoredMemberInsert(bucket: string) {
  return `CREATE POLICY synthetic_pre_fix_member_insert ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = '${bucket}'
    AND split_part(name, '/', 1) IN (SELECT workspace_id::text FROM workspace_members WHERE user_id = auth.uid()));`;
}

describe.skipIf(!LIVE_RLS)("native artifact Storage writes are server-only", () => {
  it("refuses every workspace role's direct writes, keeps reads and isolation, and keeps service writes counted", () => {
    expect(probe()).toContain("artifact-storage-policy-verified");
  });

  it("survives a harmless policy comment", () => {
    expect(probe("COMMENT ON POLICY report_artifacts_workspace_read ON storage.objects IS 'Synthetic harmless control';"))
      .toContain("artifact-storage-policy-verified");
  });

  it.each([
    ["report-artifacts", "Owner upload to report-artifacts was allowed"],
    ["grant-application-exports", "Owner upload to grant-application-exports was allowed"],
  ])("detects a restored member insert policy for %s", (bucket, expected) => {
    expect(probeFailure(restoredMemberInsert(bucket))).toContain(expected);
  });

  it.each([
    ["report_artifacts_workspace_read", "Owner lost read access to report-artifacts"],
    ["grant_application_exports_workspace_read", "Owner lost read access to grant-application-exports"],
  ])("detects a lost read policy %s", (policy, expected) => {
    expect(probeFailure(`DROP POLICY ${policy} ON storage.objects;`)).toContain(expected);
  });

  it("detects a member update policy", () => {
    expect(probeFailure(`CREATE POLICY synthetic_member_update ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'report-artifacts') WITH CHECK (bucket_id = 'report-artifacts');`))
      .toContain("A workspace role changed or removed a stored report or export");
  });

  it("detects a lost writer gate", () => {
    expect(probeFailure("DROP POLICY artifact_storage_writer_insert ON storage.objects;"))
      .toContain("Viewer report upload passed the writer gate");
  });
});
