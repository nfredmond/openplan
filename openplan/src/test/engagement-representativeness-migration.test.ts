import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260719000095_engagement_representativeness_cache.sql"),
  "utf8"
);

describe("engagement_representativeness_cache migration", () => {
  it("adds the cache columns to engagement_campaigns", () => {
    expect(migration).toContain("ALTER TABLE engagement_campaigns");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS representativeness_json jsonb");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS representativeness_computed_at timestamptz");
  });
});
