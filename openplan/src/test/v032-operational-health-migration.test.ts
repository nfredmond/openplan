import { describe, expect, it } from "vitest";
import { readMigration } from "./migrations/read-migrations";

const sql = readMigration("20260824000006_worker_health_reminder_preferences_and_crash_cutoff.sql");

describe("v0.32 operational health schema", () => {
  it("keeps worker heartbeats deployment-global and service-role-only", () => {
    expect(sql).toMatch(/CREATE TABLE public\.modeling_worker_heartbeats/i);
    expect(sql).toMatch(/PRIMARY KEY \(worker_kind, instance_id\)/i);
    expect(sql).toMatch(/ALTER TABLE public\.modeling_worker_heartbeats ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.modeling_worker_heartbeats FROM anon, authenticated/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]+modeling_worker_heartbeats/i);
  });

  it("gives members read access and only owners or admins write access to reminder preferences", () => {
    expect(sql).toMatch(/CREATE TABLE public\.workspace_reminder_preferences/i);
    expect(sql).toMatch(/advance_days INTEGER NOT NULL DEFAULT 7 CHECK \(advance_days BETWEEN 1 AND 30\)/i);
    expect(sql).toMatch(/email_digest_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
    expect(sql.match(/wm\.role IN \('owner', 'admin'\)/g) ?? []).toHaveLength(3);
  });

  it("stores cutoff and provenance only as a pair", () => {
    expect(sql).toMatch(/ADD COLUMN published_through DATE/i);
    expect(sql).toMatch(/ADD COLUMN published_through_provenance JSONB/i);
    expect(sql).toMatch(/published_through IS NULL AND published_through_provenance IS NULL/i);
    expect(sql).toMatch(/published_through IS NOT NULL AND published_through_provenance IS NOT NULL/i);
  });
});
