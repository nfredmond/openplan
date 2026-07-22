import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260722000004_reap_model_run_rpc.sql"),
  "utf8"
);

describe("reap_model_run_if_stale migration", () => {
  it("defines the reaper function with the documented signature", () => {
    expect(migration).toMatch(/create or replace function public\.reap_model_run_if_stale\(/);
    expect(migration).toMatch(/p_run_id uuid/);
    expect(migration).toMatch(/p_stale_before timestamptz/);
    expect(migration).toMatch(/p_message text/);
    expect(migration).toMatch(/returns boolean/);
  });

  it("re-validates progress across BOTH tables before flipping status (race-free guard)", () => {
    // Run row untouched since snapshot...
    expect(migration).toMatch(/r\.updated_at <= p_stale_before/);
    // ...and no stage has progressed since snapshot.
    expect(migration).toMatch(/not exists/i);
    expect(migration).toMatch(/s\.updated_at > p_stale_before/);
    // Only ever transitions non-terminal rows.
    expect(migration).toMatch(/status in \('queued', 'running'\)/);
  });

  it("locks execute down to the service role only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) from public/
    );
    expect(migration).toMatch(
      /grant execute on function public\.reap_model_run_if_stale\(uuid, timestamptz, text\) to service_role/
    );
  });
});
