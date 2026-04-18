#!/usr/bin/env node
// T1 generate + re-ground live proof.
//
// Starting state: report e7502b16-... has rtp_basis_stale=true from the
// 2026-04-17 scenario-writeback proof. The banner on the RTP-linked
// report-detail page instructs the user: "Regenerate the packet to
// re-ground it on the new run." Today's bug: /api/reports/<id>/generate
// updated status/generated_at but never cleared the stale columns, so the
// banner's CTA was a lie.
//
// This proof exercises the fix: POST the generate route, then verify
// rtp_basis_stale flips back to false and the SSR banner is gone.
//
// Phases:
//   A. BEFORE snapshot — DB row + SSR contains "Basis stale"
//   B. POST /api/reports/<reportId>/generate (format: html)
//   C. DB AFTER — rtp_basis_stale=false, all 3 companions null,
//                 status=generated, generated_at set
//   D. SSR AFTER — "Basis stale" marker gone, "Packet generated" marker present

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROOF_EMAIL = "proof+2026-04-16@natford.dev";
const PROOF_PASSWORD = "openplan-proof-2026-04-16!";
const PROOF_USER_ID = "44e09473-6680-46b9-8664-a2054590f2e6";
const REPORT_ID = "e7502b16-8ec0-4b88-8501-7e8e02ea5afd";

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Need SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

{
  const { error } = await admin.auth.admin.updateUserById(PROOF_USER_ID, {
    password: PROOF_PASSWORD,
  });
  if (error) {
    console.error("admin password reset failed:", error);
    process.exit(2);
  }
}

const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
  email: PROOF_EMAIL,
  password: PROOF_PASSWORD,
});
if (signInError || !signInData.session) {
  console.error("sign-in failed:", signInError);
  process.exit(3);
}
const session = signInData.session;
const cookieHeader = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;

const ssrUrl = `http://localhost:3000/reports/${REPORT_ID}`;
const generateUrl = `http://localhost:3000/api/reports/${REPORT_ID}/generate`;

function fetchMarkerIndex(html, marker) {
  return html.indexOf(marker);
}

async function fetchReportRow() {
  const res = await admin
    .from("reports")
    .select(
      "id, status, generated_at, rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_run_id, rtp_basis_stale_marked_at"
    )
    .eq("id", REPORT_ID)
    .single();
  if (res.error) throw res.error;
  return res.data;
}

async function fetchSsrHtml() {
  const res = await fetch(ssrUrl, { headers: { Cookie: cookieHeader } });
  const body = await res.text();
  return { status: res.status, body };
}

console.log("=== PHASE A: BEFORE ===");
const rowBefore = await fetchReportRow();
console.log("  DB reports row BEFORE:");
console.log(JSON.stringify(rowBefore, null, 2));
if (rowBefore.rtp_basis_stale !== true) {
  console.error("FATAL: expected rtp_basis_stale=true on REPORT_ID. Re-run scenario proof first.");
  process.exit(4);
}

const ssrBefore = await fetchSsrHtml();
console.log(`  SSR ${ssrUrl}: ${ssrBefore.status}`);
const markersBefore = [
  "Basis stale",
  "promoted to scenario entry",
  "Marked stale on",
  "Regenerate the packet to re-ground",
];
for (const m of markersBefore) {
  const idx = fetchMarkerIndex(ssrBefore.body, m);
  console.log(`  BEFORE: ${idx >= 0 ? "FOUND  " : "MISSING"} "${m}"${idx >= 0 ? ` @ ${idx}` : ""}`);
  if (idx < 0) {
    console.error(`FATAL: expected stale-banner marker missing before regen: "${m}"`);
    process.exit(5);
  }
}

console.log("\n=== PHASE B: POST /api/reports/<id>/generate ===");
const genRes = await fetch(generateUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ format: "html" }),
});
const genJsonText = await genRes.text();
let genJson = null;
try {
  genJson = JSON.parse(genJsonText);
} catch {}
console.log(`  status = ${genRes.status}`);
console.log(`  body   = ${genJson ? JSON.stringify(genJson, null, 2) : genJsonText.slice(0, 500)}`);
if (genRes.status !== 200) {
  console.error("expected 200; got", genRes.status);
  process.exit(6);
}

console.log("\n=== PHASE C: DB AFTER ===");
const rowAfter = await fetchReportRow();
console.log("  DB reports row AFTER:");
console.log(JSON.stringify(rowAfter, null, 2));

const expectations = [
  ["rtp_basis_stale is false", rowAfter.rtp_basis_stale === false],
  ["rtp_basis_stale_reason is null", rowAfter.rtp_basis_stale_reason === null],
  ["rtp_basis_stale_run_id is null", rowAfter.rtp_basis_stale_run_id === null],
  ["rtp_basis_stale_marked_at is null", rowAfter.rtp_basis_stale_marked_at === null],
  ["status is generated", rowAfter.status === "generated"],
  ["generated_at is set", typeof rowAfter.generated_at === "string" && rowAfter.generated_at.length > 0],
];
let allGood = true;
for (const [label, ok] of expectations) {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) allGood = false;
}
if (!allGood) {
  console.error("one or more DB expectations failed");
  process.exit(7);
}

console.log("\n=== PHASE D: SSR AFTER ===");
const ssrAfter = await fetchSsrHtml();
console.log(`  SSR ${ssrUrl}: ${ssrAfter.status}`);
const gone = ["Basis stale", "promoted to scenario entry", "Marked stale on"];
for (const m of gone) {
  const idx = fetchMarkerIndex(ssrAfter.body, m);
  console.log(`  AFTER:  ${idx < 0 ? "GONE   " : "STILL  "} "${m}"${idx >= 0 ? ` @ ${idx}` : ""}`);
  if (idx >= 0) {
    console.error(`FATAL: expected stale-banner marker to be gone after regen: "${m}"`);
    process.exit(8);
  }
}
const stillThere = ["Packet generated"];
for (const m of stillThere) {
  const idx = fetchMarkerIndex(ssrAfter.body, m);
  console.log(`  AFTER:  ${idx >= 0 ? "FOUND  " : "MISSING"} "${m}"${idx >= 0 ? ` @ ${idx}` : ""}`);
}

await anon.auth.signOut();
console.log("\nsigned out; done");
