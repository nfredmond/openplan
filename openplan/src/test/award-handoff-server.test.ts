// Response classification only. No database, RPC, Storage or byte verification runs here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AWARD_HANDOFF_MIGRATION } from "@/lib/grants/award-handoff";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
import { createServiceRoleClient } from "@/lib/supabase/server";
import { handoffFailure, managedCloseout, MANAGED_AWARD_CLOSEOUT_MIGRATION } from "@/lib/grants/award-handoff-server";

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

// Prepared, UNEXECUTED. RPC mocks establish transport and refusal only, not persistence.
describe("managed closeout target transport", () => {
  const rpc = vi.fn();
  const input = { actorId: "actor", awardId: "award", expectedRevisionId: "revision", event: "reopen" as const, note: "Source amendment requires reopening" };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createServiceRoleClient>);
    rpc.mockResolvedValue({ data: { status: "reopened" }, error: null });
  });

  it.each(["delayed", "not_started", "active"])("forwards the exact %s destination", async (reopenSpendingStatus) => {
    const response = await managedCloseout({ ...input, reopenSpendingStatus });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("managed_award_closeout", {
      p_actor: "actor", p_award: "award", p_expected: "revision", p_event: "reopen", p_note: input.note, p_reopen_spending_status: reopenSpendingStatus,
    });
  });

  it("sends an absent destination as null for SQL's legacy active default", async () => {
    await managedCloseout({ ...input, expectedRevisionId: undefined });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("managed_award_closeout", {
      p_actor: "actor", p_award: "award", p_expected: null, p_event: "reopen", p_note: input.note, p_reopen_spending_status: null,
    });
  });

  it.each(["fully_spent", "unknown", "", " active"])("refuses %j before service dispatch", async (reopenSpendingStatus) => {
    expect((await managedCloseout({ ...input, reopenSpendingStatus })).status).toBe(422);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps earned coverage separate from reopen destinations and preserves revision refusal", async () => {
    expect((await managedCloseout({ ...input, event: "earned_coverage", expectedRevisionId: null })).status).toBe(409);
    expect((await managedCloseout({ ...input, event: "earned_coverage", reopenSpendingStatus: "active" })).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    await managedCloseout({ ...input, event: "earned_coverage" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("managed_award_closeout", {
      p_actor: "actor", p_award: "award", p_expected: "revision", p_event: "earned_coverage", p_note: input.note, p_reopen_spending_status: null,
    });
  });

  it("names the new migration when the destination overload is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.managed_award_closeout(p_actor, p_award, p_expected, p_event, p_note, p_reopen_spending_status) in the schema cache" } });
    const response = await managedCloseout({ ...input, reopenSpendingStatus: "delayed" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: `Award handoff requires migration ${MANAGED_AWARD_CLOSEOUT_MIGRATION}.` });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([{ code: "42501", status: 403 }, { code: "PT409", status: 409 }, { code: "22023", status: 422 }])("retains SQL $code refusal without fallback", async ({ code, status }) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "Retained SQL refusal" } });
    const response = await managedCloseout({ ...input, reopenSpendingStatus: "delayed" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Retained SQL refusal" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
