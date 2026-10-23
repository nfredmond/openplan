// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// This guard protects the prepared case's text and readback contract. It cannot
// establish SQL semantics, effective RLS, affected rows or native owner success.
it("retains viewer zero-row evidence and subsequent owner readiness", () => {
  const source = readFileSync("src/test/model-common-population-comparison-rls.test.ts", "utf8");
  const start = source.indexOf('  it("keeps the existing snapshot UPDATE policy for members and outsiders"');
  const end = source.indexOf("\n  it(", start + 1);
  expect(start, "target case exists").toBeGreaterThanOrEqual(0);
  expect(end, "target case ends before the next test").toBeGreaterThan(start);
  const body = source.slice(start, end).replace(/--[^\n]*/g, "");
  const viewerStart = body.indexOf("PERFORM set_config('request.jwt.claim.sub',(SELECT viewer_id::text FROM cp_probe),true);");
  const ownerStart = body.indexOf("PERFORM set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM cp_probe),true);");
  expect(viewerStart, "viewer actor is selected").toBeGreaterThan(0);
  expect(ownerStart, "owner follows viewer evidence checks").toBeGreaterThan(viewerStart);
  const viewer = body.slice(viewerStart, ownerStart);
  const owner = body.slice(ownerStart);

  expect(body, "snapshot before image").toContain("SELECT to_jsonb(snapshot) INTO before_snapshot FROM public.scenario_comparison_snapshots snapshot WHERE snapshot.id=s;");
  expect(body, "links before image").toContain("SELECT jsonb_agg(to_jsonb(link) ORDER BY link.id) INTO before_links FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id=s;");
  expect(viewer, "viewer attempts actual update").toContain("UPDATE public.scenario_comparison_snapshots SET status='ready' WHERE id=s;");
  expect(viewer, "viewer zero affected rows").toContain("GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Viewer updated snapshot'; END IF;");
  expect(viewer, "no unreachable trigger-error expectation").not.toContain("cp_expect_refusal");
  expect(viewer, "viewer does not use strict owner helper").not.toContain("cp_ready");
  expect(viewer, "full snapshot readback unchanged").toContain("(SELECT to_jsonb(snapshot) FROM public.scenario_comparison_snapshots snapshot WHERE snapshot.id=s) IS DISTINCT FROM before_snapshot");
  expect(viewer, "full links readback unchanged").toContain("(SELECT jsonb_agg(to_jsonb(link) ORDER BY link.id) FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id=s) IS DISTINCT FROM before_links");
  expect(viewer, "viewer preserves draft and four links").toContain("IF (SELECT status FROM public.scenario_comparison_snapshots WHERE id=s) IS DISTINCT FROM 'draft'\n        OR (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s)<>4");
  expect(owner, "owner requires strict successful update").toContain("PERFORM pg_temp.cp_ready(s);");
  expect(owner, "owner persists ready and four links").toContain("IF (SELECT status FROM public.scenario_comparison_snapshots WHERE id=s) IS DISTINCT FROM 'ready'\n        OR (SELECT count(*) FROM public.scenario_comparison_model_run_links WHERE comparison_snapshot_id=s)<>4");
  expect(owner, "retained runs and artifacts readback").toContain("RESET ROLE; SELECT pg_temp.cp_unchanged();");
});
