import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260424000072_billing_ledger_foundation.sql", "utf8");

describe("billing ledger foundation migration", () => {
  it("creates normalized subscription and usage-event tables", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.subscriptions");
    expect(migration).toContain("workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.usage_events");
    expect(migration).toContain("idempotency_key TEXT UNIQUE");
    expect(migration).toContain("stripe_reported_at TIMESTAMPTZ");
  });

  it("keeps user writes blocked while allowing workspace member reads", () => {
    expect(migration).toContain("ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY subscriptions_workspace_read");
    expect(migration).toContain("ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY usage_events_workspace_read");
    expect(migration).toContain("REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON TABLE public.subscriptions TO authenticated");
    expect(migration).toContain("REVOKE ALL ON TABLE public.usage_events FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON TABLE public.usage_events TO authenticated");
  });

  it("pins trigger search_path and backfills from workspace billing snapshots", () => {
    expect(migration).toContain("SET search_path = public, pg_catalog");
    expect(migration).toContain("INSERT INTO public.subscriptions");
    expect(migration).toContain("FROM public.workspaces w");
    expect(migration).toContain("ON CONFLICT (workspace_id) DO UPDATE");
  });
});
