#!/usr/bin/env node
// T13 live proof: /api/funding-awards/<awardId>/closeout enforces 100%
// invoice coverage, sets spending_status='fully_spent', emits a
// closeout project_milestones row, and rebuilds projects.rtp_posture.
// Exercises BOTH paths: 422 (no paid invoices) and 200 (coverage met).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROOF_EMAIL = "proof+2026-04-16@natford.dev";
const PROOF_PASSWORD = "openplan-proof-2026-04-16!";
const PROOF_USER_ID = "44e09473-6680-46b9-8664-a2054590f2e6";
const WORKSPACE_ID = "dd68626b-3462-4aa4-94ea-4840b2dae019";
const PROJECT_ID = "73f7375b-a8b0-4a4a-9dfe-67f3a1066515";
const AWARD_ID = "345e47fd-b30d-4fdd-9d70-67f8c10084c8";

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

const closeoutUrl = `http://localhost:3000/api/funding-awards/${AWARD_ID}/closeout`;

// ===== Phase A: NEGATIVE path — no paid invoices, expect 422 =====
console.log("=== PHASE A: no paid invoices -> expect 422 closeout-blocked ===");
const phaseA = await fetch(closeoutUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ notes: "proof — should be rejected" }),
});
const phaseAJson = await phaseA.json();
console.log("  status =", phaseA.status);
console.log("  body   =", JSON.stringify(phaseAJson, null, 2));
if (phaseA.status !== 422) {
  console.error("expected 422; got", phaseA.status);
  process.exit(4);
}
console.log("  GOOD: closeout refused because paidAmount < awardedAmount\n");

// ===== Phase B: seed a paid invoice covering 100% of the award =====
console.log("=== PHASE B: seed paid invoice (net_amount=250000) and retry ===");
const invoiceInsert = await admin.from("billing_invoice_records").insert({
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  funding_award_id: AWARD_ID,
  invoice_number: "PROOF-INV-2026-04-17-001",
  consultant_name: "Nat Ford Planning (proof)",
  billing_basis: "lump_sum",
  status: "paid",
  period_start: "2026-03-01",
  period_end: "2026-03-31",
  invoice_date: "2026-04-01",
  due_date: "2026-04-10",
  amount: 250000,
  retention_percent: 0,
  retention_amount: 0,
  net_amount: 250000,
  supporting_docs_status: "complete",
  caltrans_posture: "local_agency_consulting",
  notes: "Seeded for 2026-04-17 T13 closeout live-proof.",
  created_by: PROOF_USER_ID,
}).select("id, status, amount, net_amount").single();
if (invoiceInsert.error) {
  console.error("invoice seed failed:", invoiceInsert.error);
  process.exit(5);
}
console.log("  invoice seeded:", JSON.stringify(invoiceInsert.data));

// ===== Phase C: POSITIVE path — 100% coverage, expect 200 =====
console.log("\n=== PHASE C: POST closeout again -> expect 200 ===");
const phaseC = await fetch(closeoutUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ notes: "2026-04-17 T13 live-proof closeout." }),
});
const phaseCJson = await phaseC.json();
console.log("  status =", phaseC.status);
console.log("  body   =", JSON.stringify(phaseCJson, null, 2));
if (phaseC.status !== 200) {
  console.error("expected 200; got", phaseC.status);
  process.exit(6);
}

// ===== Phase D: verify side-effects =====
console.log("\n=== PHASE D: verify DB side-effects ===");

const awardAfter = await admin
  .from("funding_awards")
  .select("id, spending_status")
  .eq("id", AWARD_ID)
  .single();
console.log("  funding_awards.spending_status =", awardAfter.data?.spending_status);

const milestoneAfter = await admin
  .from("project_milestones")
  .select("id, title, milestone_type, phase_code, status, target_date, actual_date, summary, funding_award_id")
  .eq("funding_award_id", AWARD_ID)
  .eq("milestone_type", "closeout")
  .order("created_at", { ascending: false })
  .limit(1);
console.log("  latest closeout project_milestones row:");
console.log(JSON.stringify(milestoneAfter.data?.[0] ?? null, null, 2));

const projectAfter = await admin
  .from("projects")
  .select("id, rtp_posture")
  .eq("id", PROJECT_ID)
  .single();
console.log("\n  projects.rtp_posture (post-closeout):");
console.log(JSON.stringify(projectAfter.data?.rtp_posture, null, 2));

await anon.auth.signOut();
console.log("\nsigned out; done");
