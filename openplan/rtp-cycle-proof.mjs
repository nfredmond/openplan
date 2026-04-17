#!/usr/bin/env node
// T17 live-render proof: /rtp/<rtpCycleId> renders posture for a seeded cycle.
// Reuses the fixture from the 2026-04-16 write-back proof (same workspace, project, award).
// Adds: rtp_cycles row aaaaaaaa-1111-4111-8111-111111111111, project_rtp_cycle_links row.

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
const AWARD_ID = "345e47fd-b30d-4fdd-9d70-67f8c10084c8";
const RTP_CYCLE_ID = "aaaaaaaa-1111-4111-8111-111111111111";

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Need SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

// Step 1: admin password reset
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
{
  const { error } = await admin.auth.admin.updateUserById(PROOF_USER_ID, { password: PROOF_PASSWORD });
  if (error) { console.error("admin reset failed:", error); process.exit(2); }
  console.log("step 1: admin password reset OK");
}

// Step 2: sign in on anon client
const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email: PROOF_EMAIL, password: PROOF_PASSWORD });
if (signInError || !signInData.session) { console.error("sign-in failed:", signInError); process.exit(3); }
const session = signInData.session;
console.log("step 2: sign-in OK  user_id=", signInData.user.id);

// Step 3: pack session into @supabase/ssr cookie
const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
const cookieHeader = `sb-127-auth-token=${cookieValue}`;

// Step 4: fetch /rtp/<rtpCycleId>
const url = `http://localhost:3000/rtp/${RTP_CYCLE_ID}`;
const res = await fetch(url, { headers: { Cookie: cookieHeader } });
const html = await res.text();

console.log("\n=== /rtp/", RTP_CYCLE_ID, "===");
console.log("HTTP", res.status, "size", html.length, "bytes");

const markers = [
  "Proof RTP Cycle 2026",
  "Write-back Proof Project",
  "Proof STP Award",
  "Posture cached",
  "$250,000",
  "250,000",
  "constrained",
  "Anchored by Proof STP Award",
];

for (const m of markers) {
  const idx = html.indexOf(m);
  if (idx >= 0) {
    console.log(`  ${m.padEnd(36)} FOUND @${idx}`);
  } else {
    console.log(`  ${m.padEnd(36)} not found`);
  }
}

// Write the HTML for inspection
await fs.writeFile("/tmp/rtp-cycle-proof.html", html);
console.log("\nHTML written to /tmp/rtp-cycle-proof.html");

// Cleanup sign-out
await anon.auth.signOut();
console.log("signed out");
