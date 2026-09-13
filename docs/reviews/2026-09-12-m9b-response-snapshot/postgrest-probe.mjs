import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadCloseLoopEntries, loadPublishedCloseLoopEntries } from "../../../openplan/src/lib/engagement/close-loop.ts";

const require = createRequire(new URL("../../../openplan/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const account = JSON.parse(readFileSync("/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json", "utf8"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, "http://127.0.0.1:29821", "Only the named disposable API is allowed");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const anonymous = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const outsider = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const campaign = randomUUID(), sibling = randomUUID();
let outsiderId;
const result = { stack: "openplan-restore-target-2026091050", api: url, campaign, sibling, checks: [] };
const save = () => writeFileSync(new URL("postgrest-probe.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
save();
const check = (name, detail) => { result.checks.push({ name, ...detail }); save(); process.stdout.write(`${name}\n`); };
try {
  const auth = await owner.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.equal(auth.error, null);
  const created = await owner.from("engagement_campaigns").insert([
    { id: campaign, workspace_id: account.workspaceId, title: "SYNTHETIC complete-response HTTP test" },
    { id: sibling, workspace_id: account.workspaceId, title: "SYNTHETIC sibling HTTP control" },
  ]);
  assert.equal(created.error, null);
  const entries = Array.from({ length: 1005 }, (_, i) => ({
    id: randomUUID(), campaign_id: campaign, theme_title: `SYNTHETIC response ${i}`,
    you_said: "Synthetic database verification", we_did: "Synthetic test response",
    status: i % 2 === 1 ? "published" : "draft", sort_order: 0, created_at: "2026-09-12T00:00:00Z",
  }));
  for (let i = 0; i < entries.length; i += 250) {
    assert.equal((await owner.from("engagement_closeloop_entries").insert(entries.slice(i, i + 250))).error, null);
  }
  assert.equal((await owner.from("engagement_closeloop_entries").insert({ campaign_id: sibling, theme_title: "SYNTHETIC sibling response" })).error, null);

  const capped = await owner.from("engagement_closeloop_entries").select("id").eq("campaign_id", campaign);
  assert.equal(capped.error, null);
  assert.equal(capped.data.length, 1000);
  check("ordinary table read demonstrates the real silent cap", { available: 1005, returned: capped.data.length });

  const staff = await loadCloseLoopEntries(owner, campaign);
  assert.equal(staff.error, null);
  assert.equal(staff.rows.length, 1005);
  assert.deepEqual(staff.rows.map(row => row.id), entries.map(row => row.id).sort());
  assert(staff.rows.every(row => row.campaign_id === campaign));
  check("real staff loader reads every response in unique total order", { returned: staff.rows.length });

  const published = await loadPublishedCloseLoopEntries(owner, campaign);
  const publicService = await loadPublishedCloseLoopEntries(admin, campaign);
  assert.equal(published.error, null);
  assert.equal(publicService.error, null);
  assert.equal(published.rows.length, 502);
  assert.deepEqual(publicService.rows, published.rows);
  assert(published.rows.every(row => row.status === "published" && row.campaign_id === campaign));
  check("member and service public reads exclude drafts and sibling campaign", { returned: published.rows.length });

  const email = `snapshot-${randomUUID()}@example.test`, password = randomBytes(24).toString("base64url") + "A1!";
  const newUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(newUser.error, null);
  outsiderId = newUser.data.user.id;
  result.outsiderId = outsiderId;
  save();
  assert.equal((await outsider.auth.signInWithPassword({ email, password })).error, null);
  const denied = await loadCloseLoopEntries(outsider, campaign);
  assert.deepEqual(denied, { rows: [], error: null });
  const anon = await anonymous.rpc("read_engagement_response_snapshot", { p_campaign: campaign, p_published_only: false });
  assert(anon.error && anon.error.code === "42501");
  check("real authenticated outsider sees no rows and anonymous RPC is denied", { outsiderRows: 0, anonymousErrorCode: anon.error.code });

  const before = JSON.stringify(staff.rows);
  const target = staff.rows[0];
  assert.equal((await owner.from("engagement_closeloop_entries").update({ we_did: "SYNTHETIC corrected response" }).eq("campaign_id", campaign).eq("id", target.id)).error, null);
  const corrected = await loadCloseLoopEntries(owner, campaign);
  assert.equal(corrected.error, null);
  assert.equal(corrected.rows.length, 1005);
  assert.equal(corrected.rows.find(row => row.id === target.id).we_did, "SYNTHETIC corrected response");
  assert.equal(JSON.stringify(staff.rows), before);
  check("a later read observes a correction while the earlier returned object is unchanged", {
    beforeSha256: createHash("sha256").update(before).digest("hex"),
    afterSha256: createHash("sha256").update(JSON.stringify(corrected.rows)).digest("hex"),
    limit: "This is not retained server-side revision history or an in-flight concurrency probe",
  });
} finally {
  // Configuration history retains campaigns. Archive these synthetic records;
  // deleting them would either fail custody guards or require bypassing them.
  const cleanup = await admin.from("engagement_campaigns").update({ status: "archived", allow_public_submissions: false }).in("id", [campaign, sibling]);
  result.archiveError = cleanup.error?.code ?? null;
  save();
  assert.equal(cleanup.error, null, "Synthetic campaign archival failed");
  await owner.auth.signOut({ scope: "local" });
  await outsider.auth.signOut({ scope: "local" });
  result.fixturesArchived = true;
  result.outsiderRetained = outsiderId ?? null;
  result.finishedAt = new Date().toISOString();
  save();
}
