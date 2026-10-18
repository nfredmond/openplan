import { describe, expect, it, vi } from "vitest";
import { loadWorkNotifications, sweepWorkDeadlines, WORK_SWEEP_SOURCES, type WorkSweepClient } from "@/lib/notifications/work";
import { FakeWorkDb } from "./helpers/fake-work-notification-tables";
import { blankComments, readMigration } from "./migrations/read-migrations";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { loadGrantInventory } from "./migrations/grant-inventory";

const MIGRATION = "20261018000001_grant_deadline_changes.sql";
const sql = () => blankComments(readMigration(MIGRATION));
const workspace = "11111111-1111-4111-8111-111111111111";
const creator = "aaaaaaaa-0000-4000-8000-00000000000a";
const now = new Date("2026-10-18T18:00:00Z");
const opportunity = (id: string, decision = "pursue", status = "open") => ({
  id, workspace_id: workspace, created_by: creator, project_id: null, title: id,
  decision_state: decision, opportunity_status: status,
  closes_at: "2026-10-19T01:30:00Z", decision_due_at: "2026-10-19T01:30:00Z",
});

async function sweep(rows: Array<Record<string, unknown>>, errors = {}) {
  const db = new FakeWorkDb({ tables: {
    funding_opportunities: rows,
    workspaces: [{ id: workspace, name: "Synthetic workspace", time_zone: "Pacific/Honolulu" }],
    workspace_reminder_preferences: [{ workspace_id: workspace, advance_days: 1, email_digest_enabled: false }],
  }, errors });
  const loadRoster = vi.fn(async () => ({ ok: true as const, members: [{ userId: creator, email: null, role: "member" }] }));
  const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now, loadRoster });
  return { db, result, loadRoster };
}

describe("recorded grant deadline notifications", () => {
  it("reminds pursued application closes, retaining closed but excluding ended pursuits", async () => {
    const rows = [opportunity("active"), opportunity("missed", "pursue", "closed"),
      ...["monitor", "under_review", "awarded", "denied", "skip"].map((d) => opportunity(d, d)),
      opportunity("archived", "pursue", "archived"), opportunity("award-status", "pursue", "awarded"),
      { ...opportunity("unknown-creator"), created_by: null }];
    const { db, result, loadRoster } = await sweep(rows);
    const reminders = db.notifications.filter((r) => r.kind === "grant_application_due");
    expect(reminders.map((r) => r.subject_id)).toEqual(["active", "missed"]);
    expect(reminders.every((r) => r.recipient_user_id === creator && r.due_on === "2026-10-18")).toBe(true);
    expect(reminders[0].body).toContain("2026-10-19T01:30:00Z");
    expect(reminders[0].body).toContain("no assignee");
    expect(loadRoster).toHaveBeenCalledWith(expect.anything(), creator, workspace);
    expect(result.emailDigestsDisabled).toBe(1);
    expect(db.outbox).toEqual([]);
    const sourceRead = db.reads.find((r) => r.table === "funding_opportunities" && r.select.includes("closes_at"));
    expect(sourceRead?.select).toBe("id, workspace_id, project_id, title, opportunity_status, decision_state, closes_at, agency_name, created_by");
    expect(sourceRead?.filters).toContainEqual({ kind: "notNull", column: "closes_at" });
    expect(sourceRead?.filters).toContainEqual({ kind: "eq", column: "decision_state", value: "pursue" });
  });

  it("uses instant lateness and workspace calendar windows, without hiding old missed closes", async () => {
    const { db } = await sweep([
      { ...opportunity("old"), closes_at: "2020-01-01T01:00:00Z" },
      { ...opportunity("same-day-passed"), closes_at: "2026-10-18T17:59:59Z" },
      { ...opportunity("tomorrow-local"), closes_at: "2026-10-20T11:00:00Z" },
    ]);
    expect(db.notifications.map((r) => r.subject_id)).toEqual(["old", "same-day-passed"]);
    expect(db.notifications[1].body).toContain("The call has closed");
  });

  it("filters pursuit before the source cap so monitors cannot hide a current application", async () => {
    const db = new FakeWorkDb({ tables: { funding_opportunities: [
      { ...opportunity("monitor", "monitor"), closes_at: "2020-01-01T00:00:00Z" }, opportunity("active"),
    ] } });
    await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now, limitPerSource: 1, horizonDays: 7,
      loadRoster: async () => ({ ok: true, members: [{ userId: creator, email: null, role: "member" }] }),
    });
    expect(db.notifications.filter((r) => r.kind === "grant_application_due").map((r) => r.subject_id)).toEqual(["active"]);
  });

  it("reports invalid event/date shapes as unreadable rather than inventing a deadline", async () => {
    for (const row of [
      { kind: "grant_deadline_changed", due_on: "2026-10-18", deadline_change_id: "event" },
      { kind: "grant_deadline_changed", due_on: null, deadline_change_id: null },
      { kind: "grant_decision_due", due_on: null },
    ]) {
      const db = new FakeWorkDb({ tables: { work_notifications: [{ ...row, id: "notice", recipient_user_id: creator, is_read: false }] } });
      expect(await loadWorkNotifications(db, creator)).toMatchObject({ ok: false, pending: false });
    }
  });

  it("distinguishes source read failure from an empty source", async () => {
    const { result } = await sweep([], { funding_opportunities: { message: "synthetic read failure" } });
    expect(result.perSource.grant_application_due).toMatchObject({ failed: true, pending: false, message: "synthetic read failure", scanned: 0 });
  });

  it("keeps both reminder kinds for the same subject/day and counts only the inserted kind", async () => {
    const db = new FakeWorkDb({ tables: {
      funding_opportunities: [opportunity("one", "monitor")],
      workspaces: [{ id: workspace, name: "Synthetic workspace", time_zone: "UTC" }],
    } });
    const options = { now, horizonDays: 7, loadRoster: vi.fn(async () => ({ ok: true as const, members: [{ userId: creator, email: null, role: "member" }] })) };
    const first = await sweepWorkDeadlines(db as unknown as WorkSweepClient, options);
    expect(first.notificationsCreated).toBe(1);
    const read = db.reads.find((r) => r.table === "funding_opportunities");
    expect(read).toBeTruthy();
    // Change pursuit state through the same fixture row, as after a saved decision.
    const rows = [opportunity("one")];
    const secondDb = new FakeWorkDb({ tables: { funding_opportunities: rows, workspaces: [{ id: workspace, time_zone: "UTC" }] } });
    secondDb.notifications.push(...db.notifications);
    const second = await sweepWorkDeadlines(secondDb as unknown as WorkSweepClient, options);
    expect(second.notificationsCreated).toBe(1);
    expect(secondDb.notifications.map((r) => r.kind)).toEqual(["grant_decision_due", "grant_application_due"]);
    expect((await sweepWorkDeadlines(secondDb as unknown as WorkSweepClient, options)).notificationsCreated).toBe(0);
    expect(secondDb.upsertCalls[0].onConflict).toBe("subject_table,subject_id,recipient_user_id,due_on,kind");
  });

  it("keeps separate same-day notices, null due dates, exact change text and original opportunity links", async () => {
    const bodies = [
      "Application closing deadline recorded in OpenPlan. Previous: 2026-10-18T18:00:00.123456Z. New: 2026-10-18T19:00:00.123456Z.",
      "Application closing deadline recorded in OpenPlan. Previous: 2026-10-18T19:00:00.123456Z. New: not recorded (cleared).",
    ];
    const db = new FakeWorkDb({ tables: { work_notifications: bodies.map((body, index) => ({
      id: `notice-${index}`, recipient_user_id: creator, workspace_id: workspace,
      is_read: false, kind: "grant_deadline_changed", subject_table: "funding_opportunities", subject_id: "opportunity-original",
      title: "Synthetic opportunity", body, due_on: null, deadline_change_id: `event-${index}`, created_at: `2026-10-18T20:00:0${index}Z`,
    })) } });
    const inbox = await loadWorkNotifications(db, creator);
    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    expect(inbox.rows.map((r) => r.id)).toEqual(["notice-1", "notice-0"]);
    expect(inbox.rows.every((r) => r.dueOn === null)).toBe(true);
    expect(inbox.rows.map((r) => r.body)).toEqual([...bodies].reverse());
    expect(inbox.rows.map((r) => r.kind === "grant_deadline_changed" && r.eventId)).toEqual(["event-1", "event-0"]);
    expect(inbox.rows[0].opportunity).toEqual({ id: "opportunity-original", workspaceId: workspace });
    expect(db.reads[0].select).toBe("id, kind, title, body, due_on, project_id, created_at, subject_table, subject_id, workspace_id, deadline_change_id");
    expect(db.reads[0].order).toEqual({ column: "created_at", ascending: false });
  });

  it("declares the atomic, null-safe journal and distinct event/reminder keys", () => {
    const source = sql();
    expect(source).toMatch(/AFTER INSERT OR UPDATE ON public\.funding_opportunities/);
    expect(source).toContain("ARRAY['closes_at', 'decision_due_at']");
    expect(source).toContain("IF previous_at IS NOT DISTINCT FROM next_at THEN CONTINUE; END IF");
    expect(source).toContain("previous_at := (pg_catalog.to_jsonb(OLD)->>field_name)::timestamptz");
    expect(source).toContain("NEW.title, auth.uid(), NEW.created_by, recipient_state");
    expect(source).toContain("wm.workspace_id = NEW.workspace_id AND wm.user_id = NEW.created_by");
    expect(source).toContain("WHEN NEW.created_by IS NULL THEN 'creator_unknown'");
    expect(source).toContain("ELSE 'creator_not_member'");
    expect(source).toContain("INSERT INTO public.funding_opportunity_deadline_changes");
    expect(source).toContain("INSERT INTO public.work_notifications");
    expect(source).not.toMatch(/EXCEPTION\s+WHEN|ON CONFLICT|::date|date_trunc|enqueue|http/i);
    expect(source).toContain("'funding_opportunities', NEW.id, change_id, NULL, NULL");
    expect(source).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'");
    expect(source).toContain("'Actor unknown. '");
    expect(source).toContain("'Pursue-or-skip decision'");
    expect(source).toContain("'Application closing'");
    expect(source).toContain("'not recorded (cleared)'");
    expect(source).toContain("deadline_change_id, recipient_user_id");
    expect(source).toContain("subject_table, subject_id, recipient_user_id, due_on, kind");
    expect(WORK_SWEEP_SOURCES.some((s) => s.kind === ("grant_deadline_changed" as string))).toBe(false);
  });

  it("declares tenant reads, no direct journal writes, narrow functions and immutable facts", () => {
    const source = sql();
    const schema = loadSchemaInventory();
    expect(schema.rlsEnabled("funding_opportunity_deadline_changes")).toBe(true);
    const grants = loadGrantInventory();
    for (const role of ["anon", "authenticated", "public"] as const) {
      for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
        expect(grants.holds("funding_opportunity_deadline_changes", role, command)).toBe("none");
      }
    }
    expect(source).toContain("wm.workspace_id = funding_opportunity_deadline_changes.workspace_id");
    expect(source).toContain("wm.user_id = (SELECT auth.uid())");
    expect(source).toContain("REFERENCES public.funding_opportunity_deadline_changes(id, workspace_id, opportunity_id)");
    expect(source.match(/SET search_path = ''/g)).toHaveLength(2);
    for (const fn of ["record_funding_opportunity_deadline_changes", "keep_funding_deadline_facts_immutable"]) {
      expect(source).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(source).toContain("RAISE EXCEPTION 'funding_deadline_change_immutable'");
    expect(source).toContain("RAISE EXCEPTION 'funding_deadline_notice_immutable'");
    expect(source).toContain("pg_catalog.to_jsonb(NEW) - ARRAY['is_read', 'read_at']");
    expect(source).toContain("RAISE EXCEPTION 'funding_opportunity_identity_immutable'");
  });
});
