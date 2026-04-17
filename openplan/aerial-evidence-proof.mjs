#!/usr/bin/env node
// T9 live proof: POST /api/aerial/evidence-packages creates an evidence
// package AND triggers rebuildAerialProjectPosture() -> projects.aerial_posture
// write-back. Then /aerial/missions/<missionId> SSR-renders the package.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROOF_EMAIL = "proof+2026-04-16@natford.dev";
const PROOF_PASSWORD = "openplan-proof-2026-04-16!";
const PROOF_USER_ID = "44e09473-6680-46b9-8664-a2054590f2e6";
const WORKSPACE_ID = "dd68626b-3462-4aa4-94ea-4840b2dae019";
const PROJECT_ID = "73f7375b-a8b0-4a4a-9dfe-67f3a1066515";
const MISSION_ID = "bbbbbbbb-2222-4222-8222-222222222222";

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Need SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
{
  const { error } = await admin.auth.admin.updateUserById(PROOF_USER_ID, { password: PROOF_PASSWORD });
  if (error) { console.error("admin reset failed:", error); process.exit(2); }
  console.log("step 1: admin password reset OK");
}

const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
if (signInError || !signInData.session) { console.error("sign-in failed:", signInError); process.exit(3); }
const session = signInData.session;
console.log("step 2: sign-in OK");

const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
const cookieHeader = `sb-127-auth-token=${cookieValue}`;

// Pre-state: aerial_posture on project should be null
const prePosture = await admin
  .from("projects")
  .select("aerial_posture, aerial_posture_updated_at")
  .eq("id", PROJECT_ID)
  .single();
console.log("step 3: PRE-POST aerial_posture on project =", JSON.stringify(prePosture.data, null, 2));

// POST /api/aerial/evidence-packages
const postBody = JSON.stringify({
  missionId: MISSION_ID,
  title: "Proof Ortho — Measurable Output 2026-04-16",
  packageType: "measurable_output",
  status: "ready",
  verificationReadiness: "ready",
  notes: "Seeded for 2026-04-16 T9 live-render proof.",
});
const postRes = await fetch("http://localhost:3000/api/aerial/evidence-packages", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: postBody,
});
const postJson = await postRes.json();
console.log("step 4: POST /api/aerial/evidence-packages status =", postRes.status);
console.log("          response:", JSON.stringify(postJson, null, 2));

if (postRes.status !== 201) {
  console.error("non-201; aborting");
  process.exit(4);
}
const packageId = postJson.packageId;

// Verify package row
const pkg = await admin
  .from("aerial_evidence_packages")
  .select("id, mission_id, workspace_id, project_id, title, package_type, status, verification_readiness, notes, created_at")
  .eq("id", packageId)
  .single();
console.log("step 5: aerial_evidence_packages row:");
console.log(JSON.stringify(pkg.data, null, 2));

// Verify posture rebuild on project
const postPosture = await admin
  .from("projects")
  .select("aerial_posture, aerial_posture_updated_at")
  .eq("id", PROJECT_ID)
  .single();
console.log("step 6: POST-POST aerial_posture on project =");
console.log(JSON.stringify(postPosture.data, null, 2));

// SSR fetch of the mission detail page
const url = `http://localhost:3000/aerial/missions/${MISSION_ID}`;
const res = await fetch(url, { headers: { Cookie: cookieHeader } });
const html = await res.text();
console.log(`step 7: GET ${url} status=${res.status} size=${html.length} bytes`);

const markers = [
  "Proof Mission — Corridor Survey 2026-04-16",
  "Corridor survey",
  "Proof Ortho",
  "measurable_output",
  "Write-back Proof Project",
  "Grass Valley SR-49 segment",
  "Complete",
  "Ready",
];
for (const m of markers) {
  const idx = html.indexOf(m);
  if (idx >= 0) console.log(`  ${m.padEnd(44)} FOUND @${idx}`);
  else console.log(`  ${m.padEnd(44)} not found`);
}

await fs.writeFile("/tmp/aerial-mission-proof.html", html);
console.log("\nHTML written to /tmp/aerial-mission-proof.html");

await anon.auth.signOut();
console.log("signed out; done");
