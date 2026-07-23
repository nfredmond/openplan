import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260722000009_engagement_notifications.sql"),
  "utf8"
);

describe("engagement notifications migration", () => {
  it("creates the operator inbox with member read + mark-read policies", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS engagement_notifications");
    expect(migration).toContain("ALTER TABLE engagement_notifications ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("engagement_notifications_read");
    expect(migration).toContain("engagement_notifications_update");
    // scoped via workspace_members -> auth.uid()
    expect(migration).toMatch(/workspace_members wm[\s\S]*wm\.user_id = auth\.uid\(\)/);
    // written by service-role only -> NO insert/delete policy
    expect(migration).not.toContain("engagement_notifications_insert");
    expect(migration).not.toContain("engagement_notifications_delete");
    expect(migration).toMatch(/type\s+text NOT NULL CHECK \(type IN \(\s*'comment_submitted','comment_flagged','survey_response','closeloop_published'/);
  });

  it("makes the two participant-email tables service-role-only (RLS on, zero policy, REVOKE)", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS engagement_subscriptions");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS engagement_email_outbox");
    expect(migration).toContain("ALTER TABLE engagement_subscriptions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE engagement_email_outbox  ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.engagement_subscriptions FROM anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON public.engagement_email_outbox  FROM anon, authenticated");
    // no read/write policies on the sensitive tables
    expect(migration).not.toMatch(/CREATE POLICY[^;]*engagement_subscriptions/i);
    expect(migration).not.toMatch(/CREATE POLICY[^;]*engagement_email_outbox/i);
  });

  it("dedupes subscriptions per campaign+email and constrains outbox status", () => {
    expect(migration).toMatch(/UNIQUE \(campaign_id, email\)/);
    expect(migration).toMatch(/status\s+text NOT NULL DEFAULT 'queued' CHECK \(status IN \('queued','sent','skipped','failed'\)\)/);
  });
});
