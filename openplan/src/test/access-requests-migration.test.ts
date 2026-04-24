import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260424000074_access_requests.sql"),
  "utf8",
);
const hardeningMigrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260424000075_access_request_intake_hardening.sql"),
  "utf8",
);
const reviewEventsMigrationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260424000076_access_request_review_events.sql"),
  "utf8",
);

describe("access requests migration", () => {
  it("creates a service-role-only intake table with contact fields", () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.access_requests/i);
    expect(migrationSql).toMatch(/agency_name TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/contact_email TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/email_normalized TEXT NOT NULL/i);
    expect(migrationSql).toMatch(/metadata_json JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(migrationSql).not.toMatch(/\sworkspace_id\s+UUID/i);
  });

  it("keeps prospect PII behind service-role access", () => {
    expect(migrationSql).toMatch(/ALTER TABLE public\.access_requests ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.access_requests FROM PUBLIC, anon, authenticated/i);
    expect(migrationSql).toMatch(/GRANT ALL ON TABLE public\.access_requests TO service_role/i);
    expect(migrationSql).not.toMatch(/GRANT SELECT ON TABLE public\.access_requests TO authenticated/i);
    expect(migrationSql).not.toMatch(/CREATE POLICY .*access_requests/i);
  });

  it("deduplicates open requests and keeps trigger functions append-only", () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_open_per_email_idx/i);
    expect(migrationSql).toMatch(/WHERE status IN \('new', 'reviewing', 'contacted', 'invited'\)/i);
    expect(migrationSql).toMatch(/SET search_path = public, pg_catalog/i);
    expect(migrationSql).toMatch(/DROP TRIGGER IF EXISTS trg_set_access_requests_updated_at/i);
    expect(migrationSql).not.toMatch(/DROP TABLE/i);
  });

  it("adds metadata indexes for service-role abuse checks without changing access posture", () => {
    expect(hardeningMigrationSql).toMatch(/CREATE INDEX IF NOT EXISTS access_requests_source_fingerprint_created_idx/i);
    expect(hardeningMigrationSql).toMatch(/metadata_json->>'source_fingerprint'/i);
    expect(hardeningMigrationSql).toMatch(/CREATE INDEX IF NOT EXISTS access_requests_body_fingerprint_created_idx/i);
    expect(hardeningMigrationSql).toMatch(/metadata_json->>'body_fingerprint'/i);
    expect(hardeningMigrationSql).not.toMatch(/CREATE POLICY/i);
    expect(hardeningMigrationSql).not.toMatch(/GRANT/i);
    expect(hardeningMigrationSql).not.toMatch(/DROP TABLE/i);
  });

  it("adds a service-role-only review event trail and atomic triage recorder", () => {
    expect(reviewEventsMigrationSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.access_request_review_events/i);
    expect(reviewEventsMigrationSql).toMatch(/access_request_id UUID NOT NULL REFERENCES public\.access_requests\(id\)/i);
    expect(reviewEventsMigrationSql).toMatch(/previous_status TEXT NOT NULL/i);
    expect(reviewEventsMigrationSql).toMatch(/status TEXT NOT NULL/i);
    expect(reviewEventsMigrationSql).toMatch(/ALTER TABLE public\.access_request_review_events ENABLE ROW LEVEL SECURITY/i);
    expect(reviewEventsMigrationSql).toMatch(
      /REVOKE ALL ON TABLE public\.access_request_review_events FROM PUBLIC, anon, authenticated/i,
    );
    expect(reviewEventsMigrationSql).toMatch(/GRANT ALL ON TABLE public\.access_request_review_events TO service_role/i);
    expect(reviewEventsMigrationSql).not.toMatch(/CREATE POLICY .*access_request_review_events/i);
    expect(reviewEventsMigrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_access_request_triage/i);
    expect(reviewEventsMigrationSql).toMatch(/SECURITY INVOKER/i);
    expect(reviewEventsMigrationSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_access_request_triage/i);
    expect(reviewEventsMigrationSql).not.toMatch(/SECURITY DEFINER/i);
    expect(reviewEventsMigrationSql).not.toMatch(/DROP TABLE/i);
  });
});
