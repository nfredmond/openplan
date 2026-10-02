import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";

/** Native policy checks use rolled-back synthetic rows, never stored file bytes. */
function probe(mutation = "") {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const actor = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
  const sql = `BEGIN;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
${mutation}
INSERT INTO auth.users(id,aud,role,email) VALUES('${actor}','authenticated','authenticated','security-${actor}@example.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES
 ('${workspace}','SYNTHETIC Storage policy','security-${workspace}'),
 ('${foreignWorkspace}','SYNTHETIC foreign Storage policy','security-${foreignWorkspace}');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${actor}','viewer');
CREATE FUNCTION pg_temp.assert_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.expect_denied(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION '%',label;
END $$;
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('report-artifacts','${workspace}/synthetic/retained.pdf'),
 ('grant-application-exports','${workspace}/synthetic/retained.pdf');
SELECT set_config('request.jwt.claim.sub','${actor}',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE name='${workspace}/synthetic/retained.pdf'),'Viewer read was removed');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('report-artifacts','${workspace}/synthetic/viewer.pdf')$q$,'Viewer report upload was allowed');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('grant-application-exports','${workspace}/synthetic/viewer.pdf')$q$,'Viewer grant upload was allowed');
RESET ROLE;
UPDATE public.workspace_members SET role='member' WHERE workspace_id='${workspace}' AND user_id='${actor}';
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('report-artifacts','${workspace}/synthetic/member.pdf'),
 ('grant-application-exports','${workspace}/synthetic/member.pdf');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE name='${workspace}/synthetic/member.pdf'),'Member uploads did not persist');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('report-artifacts','${foreignWorkspace}/synthetic/member.pdf')$q$,'Foreign report upload was allowed');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('grant-application-exports','${foreignWorkspace}/synthetic/member.pdf')$q$,'Foreign grant upload was allowed');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('gtfs-uploads','${workspace}/synthetic/member.zip')$q$,'Unrelated service-only bucket was opened');
RESET ROLE;
DELETE FROM public.workspace_members WHERE workspace_id='${workspace}' AND user_id='${actor}';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE name='${workspace}/synthetic/retained.pdf'),'Revoked reader retained access');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('report-artifacts','${workspace}/synthetic/revoked.pdf')$q$,'Revoked report upload was allowed');
SELECT pg_temp.expect_denied($q$INSERT INTO storage.objects(bucket_id,name) VALUES('grant-application-exports','${workspace}/synthetic/revoked.pdf')$q$,'Revoked grant upload was allowed');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('report-artifacts','${workspace}/synthetic/worker.pdf'),
 ('grant-application-exports','${workspace}/synthetic/worker.pdf');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE name='${workspace}/synthetic/worker.pdf'),'Service worker upload was removed');
SELECT 'artifact-storage-policy-verified';
ROLLBACK;`;
  return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 25000,
  });
}

describe.skipIf(!LIVE_RLS)("native artifact Storage write roles", () => {
  it("retains viewer reads, member writes, workspace isolation and worker writes", () => {
    expect(probe()).toContain("artifact-storage-policy-verified");
  });

  it("survives a harmless policy comment", () => {
    expect(probe("COMMENT ON POLICY artifact_storage_writer_insert ON storage.objects IS 'Synthetic harmless control';"))
      .toContain("artifact-storage-policy-verified");
  });

  it.each([
    ["report-artifacts", "Viewer report upload was allowed"],
    ["grant-application-exports", "Viewer grant upload was allowed"],
  ])("detects the lost writer gate for %s", (bucket, expected) => {
    let failure: unknown;
    try {
      probe(`ALTER POLICY artifact_storage_writer_insert ON storage.objects WITH CHECK (
        bucket_id='${bucket}' OR bucket_id NOT IN ('report-artifacts','grant-application-exports') OR EXISTS(
          SELECT 1 FROM public.workspace_members member WHERE member.workspace_id::text=split_part(name,'/',1)
            AND member.user_id=auth.uid() AND member.role IN ('owner','admin','member')));`);
    } catch (error) { failure = error; }
    expect(failure, "The defective policy must fail the viewer assertion").toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});
