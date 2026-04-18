#!/usr/bin/env node
// T4 live proof: PATCH /api/models/<modelId>/runs/<modelRunId> promotes a
// succeeded model_run into a scenario_entry, calls
// markScenarioLinkedReportsBasisStale, flips reports.rtp_basis_stale=true on
// the linked RTP packet, and the SSR report-detail page renders a "Basis
// stale" banner. Reuses the 2026-04-17 proof fixture.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROOF_EMAIL = "proof+2026-04-16@natford.dev";
const PROOF_PASSWORD = "openplan-proof-2026-04-16!";
const PROOF_USER_ID = "44e09473-6680-46b9-8664-a2054590f2e6";
const WORKSPACE_ID = "dd68626b-3462-4aa4-94ea-4840b2dae019";
const PROJECT_ID = "73f7375b-a8b0-4a4a-9dfe-67f3a1066515";
const REPORT_ID = "e7502b16-8ec0-4b88-8501-7e8e02ea5afd";

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Need SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
{
  const { error } = await admin.auth.admin.updateUserById(PROOF_USER_ID, { password: PROOF_PASSWORD });
  if (error) { console.error("admin reset failed:", error); process.exit(2); }
}

const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
if (signInError || !signInData.session) { console.error("sign-in failed:", signInError); process.exit(3); }
const session = signInData.session;
const cookieHeader = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;

const scenarioSetId = randomUUID();
const scenarioEntryId = randomUUID();
const modelId = randomUUID();
const analysisRunId = randomUUID();
const modelRunId = randomUUID();
const nowIso = new Date().toISOString();

// ===== Phase A: confirm BEFORE state (stale=false, no banner) =====
console.log("=== PHASE A: BEFORE — confirm rtp_basis_stale=false + no banner in SSR HTML ===");
const beforeReport = await admin.from("reports").select("rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_run_id, rtp_basis_stale_marked_at").eq("id", REPORT_ID).single();
console.log("  reports row BEFORE:", JSON.stringify(beforeReport.data));
if (beforeReport.data?.rtp_basis_stale) {
  console.error("expected rtp_basis_stale=false before proof; got true. Run supabase db reset or clear stale flags.");
  process.exit(4);
}

const reportUrl = `http://localhost:3000/reports/${REPORT_ID}`;
const beforeSsr = await fetch(reportUrl, { headers: { Cookie: cookieHeader } });
const beforeHtml = await beforeSsr.text();
console.log("  SSR status =", beforeSsr.status);
const beforeHasBanner = beforeHtml.includes("Basis stale");
console.log("  SSR contains 'Basis stale' BEFORE:", beforeHasBanner);

// ===== Phase B: seed scenario_set + scenario_entry + model + analysis run + model_run + report_runs =====
console.log("\n=== PHASE B: seed dependencies ===");

const scenarioSet = await admin.from("scenario_sets").insert({
  id: scenarioSetId,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  title: "Proof Scenario Set — T4 writeback",
  summary: "Seeded for 2026-04-17 T4 scenario-writeback live-proof.",
  status: "active",
  created_by: PROOF_USER_ID,
}).select("id").single();
if (scenarioSet.error) { console.error("scenario_set seed failed:", scenarioSet.error); process.exit(5); }
console.log("  scenario_set:", scenarioSet.data.id);

const scenarioEntry = await admin.from("scenario_entries").insert({
  id: scenarioEntryId,
  scenario_set_id: scenarioSetId,
  entry_type: "alternative",
  label: "Alt A — proof",
  slug: "alt-a-proof",
  summary: "Alternative entry seeded for the T4 proof.",
  status: "draft",
  sort_order: 1,
  created_by: PROOF_USER_ID,
}).select("id").single();
if (scenarioEntry.error) { console.error("scenario_entry seed failed:", scenarioEntry.error); process.exit(6); }
console.log("  scenario_entry:", scenarioEntry.data.id);

const model = await admin.from("models").insert({
  id: modelId,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  scenario_set_id: scenarioSetId,
  title: "Proof Model — T4 writeback",
  model_family: "scenario_model",
  status: "ready_for_review",
  summary: "Seeded for 2026-04-17 T4 scenario-writeback live-proof.",
  created_by: PROOF_USER_ID,
}).select("id").single();
if (model.error) { console.error("model seed failed:", model.error); process.exit(7); }
console.log("  model:", model.data.id);

const analysisRun = await admin.from("runs").insert({
  id: analysisRunId,
  workspace_id: WORKSPACE_ID,
  title: "Proof Analysis Run — T4",
  query_text: "SELECT 1;",
  metrics: { networkVmt: 12345 },
  summary_text: "Seeded analysis run for T4 scenario-writeback proof.",
}).select("id").single();
if (analysisRun.error) { console.error("analysis run seed failed:", analysisRun.error); process.exit(8); }
console.log("  analysis run (runs):", analysisRun.data.id);

const modelRun = await admin.from("model_runs").insert({
  id: modelRunId,
  workspace_id: WORKSPACE_ID,
  model_id: modelId,
  scenario_set_id: scenarioSetId,
  source_analysis_run_id: analysisRunId,
  engine_key: "deterministic_corridor_v1",
  launch_source: "model_detail",
  status: "succeeded",
  run_title: "Proof Model Run — T4",
  started_at: nowIso,
  completed_at: nowIso,
  created_by: PROOF_USER_ID,
}).select("id, status, source_analysis_run_id").single();
if (modelRun.error) { console.error("model_run seed failed:", modelRun.error); process.exit(9); }
console.log("  model_run:", JSON.stringify(modelRun.data));

const reportRun = await admin.from("report_runs").insert({
  report_id: REPORT_ID,
  run_id: analysisRunId,
  sort_order: 0,
}).select("id").single();
if (reportRun.error) { console.error("report_runs link seed failed:", reportRun.error); process.exit(10); }
console.log("  report_runs link:", reportRun.data.id);

// ===== Phase C: PATCH promote — expect 200 + stale flag flip =====
console.log("\n=== PHASE C: PATCH /api/models/<id>/runs/<runId> with {scenarioEntryId} — expect 200 ===");
const patchUrl = `http://localhost:3000/api/models/${modelId}/runs/${modelRunId}`;
const patchResp = await fetch(patchUrl, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ scenarioEntryId }),
});
const patchJson = await patchResp.json().catch(() => ({}));
console.log("  status =", patchResp.status);
console.log("  body   =", JSON.stringify(patchJson, null, 2));
if (patchResp.status !== 200) { console.error("expected 200; got", patchResp.status); process.exit(11); }

// ===== Phase D: verify DB writes =====
console.log("\n=== PHASE D: verify rtp_basis_stale flipped + scenario_entry.attached_run_id set ===");

const afterReport = await admin.from("reports").select("rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_run_id, rtp_basis_stale_marked_at").eq("id", REPORT_ID).single();
console.log("  reports row AFTER:", JSON.stringify(afterReport.data, null, 2));

const afterEntry = await admin.from("scenario_entries").select("status, attached_run_id").eq("id", scenarioEntryId).single();
console.log("  scenario_entries row AFTER:", JSON.stringify(afterEntry.data));

// ===== Phase E: re-render /reports/<id> SSR — expect stale banner markers =====
console.log("\n=== PHASE E: SSR /reports/<id> AFTER — expect 'Basis stale' + reason markers ===");
const afterSsr = await fetch(reportUrl, { headers: { Cookie: cookieHeader } });
const afterHtml = await afterSsr.text();
console.log("  SSR status =", afterSsr.status);

const markers = [
  "Basis stale",
  "promoted to scenario entry",
  "Marked stale on",
  "Regenerate the packet to re-ground",
];
let allFound = true;
for (const m of markers) {
  const idx = afterHtml.indexOf(m);
  console.log(`  ${idx >= 0 ? "FOUND" : "MISSING"}: ${JSON.stringify(m)} @ ${idx}`);
  if (idx < 0) allFound = false;
}
if (!allFound) {
  console.error("one or more stale-banner markers missing from SSR HTML");
  process.exit(12);
}

await anon.auth.signOut();
console.log("\nsigned out; done");
