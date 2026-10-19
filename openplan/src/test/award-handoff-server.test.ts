// Response classification only. No database, RPC, Storage or byte verification runs here.
import { describe, expect, it, vi } from "vitest";
import { AWARD_HANDOFF_MIGRATION } from "@/lib/grants/award-handoff";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
import { handoffFailure } from "@/lib/grants/award-handoff-server";

describe("award handoff canonical pending-schema responses", () => {
  it.each([
    'relation "public.funding_award_handoff_revisions" does not exist',
    'column funding_awards.current_handoff_revision_id does not exist',
    "Could not find the table 'public.funding_award_handoff_revisions' in the schema cache",
    "Could not find the 'handoff_origin_revision_id' column of 'project_submittals' in the schema cache",
    "Could not find the function public.award_handoff_command(p_actor, p_award) in the schema cache",
  ])("names the migration for %s", async (message) => {
    const response = handoffFailure({ message });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: `Award handoff requires migration ${AWARD_HANDOFF_MIGRATION}.` });
  });

  it.each([
    { code: "42501", message: "permission denied for table funding_award_handoff_revisions", status: 403 },
    { code: "PT409", message: "Reviewed source identity changed", status: 409 },
    { code: "40001", message: "could not serialize access due to concurrent update", status: 409 },
    { code: "22023", message: "Retained notice source does not exist for this award", status: 422 },
    { code: "23503", message: "Award handoff source does not exist in the reviewed project", status: 422 },
    { code: "23514", message: "Retained award evidence is immutable", status: 422 },
    { code: "22P02", message: 'invalid input syntax for type uuid: "invalid"', status: 422 },
    { code: "22007", message: 'invalid input syntax for type date: "invalid"', status: 422 },
    { code: "22008", message: 'date/time field value out of range: "2026-13-01"', status: 422 },
    { code: "XX000", message: "Retained seed receipt does not exist", status: 500 },
    { code: "PGRST301", message: "JWT expired", status: 500 },
  ])("preserves $status for $message", async ({ code, message, status }) => {
    const response = handoffFailure({ code, message });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: status === 500
        ? "Award handoff failed. Retain and retry the exact reviewed request after a lost response."
        : message,
    });
  });
});
