#!/usr/bin/env node
// T1 live proof: POST /api/reports with reportType=board_packet + rtpCycleId
// creates a new reports row + default sections + audit trail.
// Reuses the 2026-04-16 proof fixture (same user, workspace, project, award, cycle).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROOF_EMAIL = "proof+2026-04-16@natford.dev";
const PROOF_PASSWORD = "openplan-proof-2026-04-16!";
const PROOF_USER_ID = "44e09473-6680-46b9-8664-a2054590f2e6";
const WORKSPACE_ID = "dd68626b-3462-4aa4-94ea-4840b2dae019";
const RTP_CYCLE_ID = "aaaaaaaa-1111-4111-8111-111111111111";

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Need SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

// Step 1: admin password reset (idempotent; safe to repeat)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
{
  const { error } = await admin.auth.admin.updateUserById(PROOF_USER_ID, { password: PROOF_PASSWORD });
  if (error) { console.error("admin reset failed:", error); process.exit(2); }
  console.log("step 1: admin password reset OK");
}

// Step 2: sign in as the proof user
const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
if (signInError || !signInData.session) { console.error("sign-in failed:", signInError); process.exit(3); }
const session = signInData.session;
console.log("step 2: sign-in OK  user_id=", signInData.user.id);

// Step 3: pack the session for @supabase/ssr cookie
const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
const cookieHeader = `sb-127-auth-token=${cookieValue}`;

// Step 4: capture reports-row count BEFORE the POST
const beforeCount = await admin
  .from("reports")
  .select("id", { count: "exact", head: true })
  .eq("rtp_cycle_id", RTP_CYCLE_ID);
console.log("step 4: before count =", beforeCount.count);

// Step 5: POST /api/reports with a board_packet payload
const postBody = JSON.stringify({
  rtpCycleId: RTP_CYCLE_ID,
  reportType: "board_packet",
  summary: "Live-render proof packet for 2026-04-16 T1 close-the-loop evidence.",
});
const postRes = await fetch("http://localhost:3000/api/reports", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  },
  body: postBody,
});
const postJson = await postRes.json();
console.log("step 5: POST /api/reports status =", postRes.status);
console.log("          response:", JSON.stringify(postJson, null, 2));

if (postRes.status !== 201) {
  console.error("non-201 response; aborting");
  process.exit(4);
}
const reportId = postJson.reportId;

// Step 6: verify the row landed with the right shape
const after = await admin
  .from("reports")
  .select("id, workspace_id, project_id, rtp_cycle_id, title, report_type, status, summary, created_by, metadata_json, created_at")
  .eq("id", reportId)
  .single();
console.log("step 6: reports row after insert:");
console.log(JSON.stringify(after.data, null, 2));

// Step 7: verify default sections were created
const sections = await admin
  .from("report_sections")
  .select("section_key, title, enabled, sort_order")
  .eq("report_id", reportId)
  .order("sort_order", { ascending: true });
console.log("step 7: report_sections count =", sections.data?.length ?? 0);
for (const s of sections.data ?? []) {
  console.log(`  [${s.sort_order}] ${s.section_key.padEnd(32)} "${s.title}" enabled=${s.enabled}`);
}

// Step 8: verify the audit action execution row
const audit = await admin
  .from("planner_agent_action_executions")
  .select("action_kind, audit_event, approval, regrounding, outcome, input_summary, started_at, completed_at")
  .eq("workspace_id", WORKSPACE_ID)
  .eq("action_kind", "create_rtp_packet_record")
  .order("completed_at", { ascending: false })
  .limit(1);
console.log("step 8: latest planner_agent_action_executions row for create_rtp_packet_record:");
console.log(JSON.stringify(audit.data?.[0] ?? null, null, 2));

// Cleanup: sign-out
await anon.auth.signOut();
console.log("signed out; done");
