import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260727000008_reports_engagement_campaign_target.sql"
  ),
  "utf8"
);

// Strip `--` line comments so the header prose can never satisfy an assertion
// that is meant to hold against executable SQL.
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("reports engagement campaign target migration", () => {
  it("adds the campaign target column idempotently with a cascading FK", () => {
    expect(sql).toMatch(
      /ALTER TABLE reports\s+ADD COLUMN IF NOT EXISTS engagement_campaign_id UUID REFERENCES engagement_campaigns\(id\) ON DELETE CASCADE/
    );
  });

  it("indexes campaign-targeted reports partially, not every row", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_reports_engagement_campaign_updated_at\s+ON reports\(engagement_campaign_id, updated_at DESC\)\s+WHERE engagement_campaign_id IS NOT NULL/
    );
  });

  it("swaps the target-presence constraint to a three-way exactly-one", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS reports_target_presence/);
    expect(sql).toMatch(
      /ADD CONSTRAINT reports_target_presence\s+CHECK \(num_nonnulls\(project_id, rtp_cycle_id, engagement_campaign_id\) = 1\)/
    );
  });

  it("guards the constraint re-add behind a pg_constraint existence check", () => {
    expect(sql).toContain("FROM pg_constraint");
    expect(sql).toContain("WHERE conname = 'reports_target_presence'");
    expect(sql).toMatch(/DO \$\$/);
  });

  it("stays additive: no table or column drops", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it("keeps the header honest about why the swap loses no data", () => {
    // The prose explanation lives in comments; assert against the raw file.
    expect(raw).toMatch(/loses no data/i);
    expect(raw).toMatch(/num_nonnulls\(project_id, rtp_cycle_id\) = 1/);
  });
});
