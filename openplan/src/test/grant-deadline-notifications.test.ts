import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkNotifications, sweepWorkDeadlines, WORK_NOTIFICATION_WRITE_COLUMNS, WORK_SWEEP_SOURCES, type WorkSweepClient } from "@/lib/notifications/work";
import { FakeWorkDb, workNotificationUniqueKey, type FakeWorkDbOptions } from "./helpers/fake-work-notification-tables";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { loadGrantInventory } from "./migrations/grant-inventory";

const MIGRATION = "20261018000001_grant_deadline_changes.sql";
const sql = () => blankComments(readMigration(MIGRATION));
const activationProposal = "20261018000004_work_notification_kind_activation.sql";
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
  }, errors, reminderStage: "active" });
  const loadRoster = vi.fn(async () => ({ ok: true as const, members: [{ userId: creator, email: null, role: "member" }] }));
  const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now, loadRoster });
  return { db, result, loadRoster };
}

describe("recorded grant deadline notifications", () => {
  it("preserves the old arbiter in stage one and keeps activation outside migration up", () => {
    expect(workNotificationUniqueKey("ux_work_notifications_subject_recipient"))
      .toEqual(["subject_table", "subject_id", "recipient_user_id", "due_on"]);
    expect(workNotificationUniqueKey()).toEqual(["subject_table", "subject_id", "recipient_user_id", "due_on", "kind"]);
    expect(sql()).not.toMatch(/DROP\s+INDEX\s+public\.ux_work_notifications_subject_recipient\b/);
    expect(sql()).toMatch(/work_notification_kind_activation\(\)[\s\S]*?SELECT false;/);
    expect(sql()).toContain("GRANT EXECUTE ON FUNCTION public.work_notification_kind_activation() TO service_role");
    expect(sql()).toContain("REVOKE ALL ON FUNCTION public.work_notification_kind_activation() FROM PUBLIC, anon, authenticated, service_role");
    expect(migrationFiles()).not.toContain(activationProposal);
    const proposal = blankComments(readFileSync(path.join(process.cwd(), "..", "docs/reviews/2026-10-18-grant-deadline-alerts", activationProposal), "utf8"));
    expect(proposal).toContain("DROP INDEX public.ux_work_notifications_subject_recipient;");
    expect(proposal).toMatch(/work_notification_kind_activation\(\)[\s\S]*?SELECT true;/);
    expect(proposal).not.toMatch(/DROP\s+INDEX[^;]*subject_recipient_kind|DELETE FROM|UPDATE public\.work_notifications/);
  });

  it("declares a service-only invoker batch writer with targetless insertion and post-conflict classification", () => {
    const source = sql();
    const writer = source.slice(source.indexOf("CREATE FUNCTION public.insert_work_notification_reminders(p_rows jsonb)"),
      source.indexOf("CREATE FUNCTION public.record_funding_opportunity_deadline_changes()"));
    expect(writer).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''/);
    expect(writer).toContain("ON CONFLICT DO NOTHING");
    expect(writer).not.toMatch(/ON CONFLICT\s*\(|(?:^|\n)\s*EXECUTE\b|SECURITY DEFINER|EXCEPTION\s+WHEN|UPDATE public|DELETE FROM/i);
    expect(writer).toContain("FOR SHARE");
    expect(writer).toContain("LOCK TABLE public.work_notifications IN ROW EXCLUSIVE MODE");
    expect(writer).toContain("'duplicate'");
    expect(writer).toContain("'deferred_old_key'");
    expect(writer).toContain("work_reminder_classification_missing");
    expect(writer).toContain("work_reminder_kind_key_missing");
    expect(writer).toContain("work_reminder_inserted_facts_changed");
    expect(writer).toContain("pg_catalog.jsonb_array_length(p_rows)");
    expect(writer).toContain("subject_id uuid, project_id uuid, due_on date, title text, body text");
    expect(writer).toContain("REVOKE ALL ON FUNCTION public.insert_work_notification_reminders(jsonb) FROM PUBLIC, anon, authenticated, service_role");
    expect(writer).toContain("GRANT EXECUTE ON FUNCTION public.insert_work_notification_reminders(jsonb) TO service_role");
  });

  it("lets an old four-column writer insert and retry after stage one without 42P10", async () => {
    const db = new FakeWorkDb({ tables: {} });
    const row = { workspace_id: workspace, recipient_user_id: creator, subject_table: "funding_opportunities", subject_id: "one",
      kind: "grant_decision_due", due_on: "2026-10-19", title: "Synthetic", body: "Existing reminder", project_id: null };
    const write = () => db.from("work_notifications").upsert([row], {
      onConflict: "subject_table,subject_id,recipient_user_id,due_on", ignoreDuplicates: true,
    }).select("subject_id,kind");
    expect(await write()).toEqual({ data: [{ subject_id: "one", kind: "grant_decision_due" }], error: null });
    expect(await write()).toEqual({ data: [], error: null });
    expect(db.notifications).toHaveLength(1);
  });

  it("models the stage-one four-column collision and the active-stage old-writer refusal", async () => {
    const row = { workspace_id: workspace, recipient_user_id: creator, subject_table: "funding_opportunities", subject_id: "one",
      kind: "grant_decision_due", due_on: "2026-10-19", title: "Synthetic", body: "Existing reminder", project_id: null };
    const bridge = new FakeWorkDb({ tables: {} });
    bridge.notifications.push(row);
    const blocked = await bridge.from("work_notifications").upsert([{ ...row, kind: "grant_application_due" }], {
      onConflict: "subject_table,subject_id,recipient_user_id,due_on,kind", ignoreDuplicates: true,
    }).select("kind");
    expect(blocked.error?.message).toContain("23505");
    expect(bridge.notifications).toEqual([row]);
    const active = new FakeWorkDb({ tables: {}, reminderStage: "active" });
    const retired = await active.from("work_notifications").upsert([row], {
      onConflict: "subject_table,subject_id,recipient_user_id,due_on", ignoreDuplicates: true,
    }).select("kind");
    expect(retired.error?.message).toContain("42P10");
    expect(active.notifications).toHaveLength(0);
  });

  it("runs the bridge sweep while explicitly deferring application reminders, including a same-instant collision", async () => {
    const db = new FakeWorkDb({ tables: { funding_opportunities: [opportunity("one"), opportunity("other", "monitor")],
      workspaces: [{ id: workspace, time_zone: "UTC" }] } });
    db.notifications.push({ recipient_user_id: creator, subject_table: "funding_opportunities", subject_id: "one",
      kind: "grant_decision_due", due_on: "2026-10-19" });
    const options = { now, horizonDays: 7, loadRoster: async () => ({ ok: true as const, members: [{ userId: creator, email: null, role: "member" }] }) };
    const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, options);
    expect(result.writeError).toBeNull();
    expect(result.notificationsCreated).toBe(1);
    expect(result.digestsComposed).toBe(1);
    expect(result.perSource.grant_application_due).toMatchObject({ pending: true, failed: false, scanned: 0, candidates: 0 });
    expect(result.perSource.grant_application_due.message).toContain("older sweep writers retire");
    expect(db.rpcCalls).toEqual(["work_notification_kind_activation", "insert_work_notification_reminders"]);
    expect(db.reads.some((read) => read.table === "funding_opportunities" && read.select.includes("closes_at"))).toBe(false);
    expect(db.notifications.map((row) => row.kind)).toEqual(["grant_decision_due", "grant_decision_due"]);
    expect((await sweepWorkDeadlines(db as unknown as WorkSweepClient, options)).notificationsCreated).toBe(0);
    expect(db.upsertCalls).toHaveLength(0);
    expect(db.reminderWriteCalls[0].select).toBe(WORK_NOTIFICATION_WRITE_COLUMNS);
  });

  it.each([null, "true", {}, 0])("keeps invalid activation %j failed rather than treating it as active", async (data) => {
    const db = new FakeWorkDb({ tables: { funding_opportunities: [opportunity("one")] }, activationResult: { data, error: null } });
    const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now });
    expect(result.perSource.grant_application_due).toMatchObject({ pending: false, failed: true, scanned: 0 });
    expect(db.notifications).toHaveLength(0);
  });

  it.each([
    ["Could not find the function public.work_notification_kind_activation in the schema cache", true],
    ["permission denied for function work_notification_kind_activation", false],
  ] as const)("reports an activation read error: %s", async (message, pending) => {
    const db = new FakeWorkDb({ tables: {}, activationResult: { data: null, error: { message } } });
    const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now });
    expect(result.perSource.grant_application_due).toMatchObject({ pending, failed: !pending, message });
  });

  it("reports a thrown activation read and keeps other sources readable", async () => {
    const db = new FakeWorkDb({ tables: {} });
    vi.spyOn(db, "rpc").mockImplementationOnce(() => Promise.reject(new Error("Synthetic activation failure")));
    const result = await sweepWorkDeadlines(db as unknown as WorkSweepClient, { now });
    expect(result.perSource.grant_application_due).toMatchObject({ pending: false, failed: true, message: "Synthetic activation failure" });
    expect(result.perSource.grant_decision_due).toMatchObject({ pending: false, failed: false });
  });

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
    ] }, reminderStage: "active" });
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

  it("keeps both same-instant reminder kinds at the active stage and counts only the inserted kind", async () => {
    expect(opportunity("one").closes_at).toBe(opportunity("one").decision_due_at);
    const db = new FakeWorkDb({ tables: {
      funding_opportunities: [opportunity("one", "monitor")],
      workspaces: [{ id: workspace, name: "Synthetic workspace", time_zone: "UTC" }],
    }, reminderStage: "active" });
    const options = { now, horizonDays: 7, loadRoster: vi.fn(async () => ({ ok: true as const, members: [{ userId: creator, email: null, role: "member" }] })) };
    const first = await sweepWorkDeadlines(db as unknown as WorkSweepClient, options);
    expect(first.notificationsCreated).toBe(1);
    expect(first.digestsComposed).toBe(1);
    const read = db.reads.find((r) => r.table === "funding_opportunities");
    expect(read).toBeTruthy();
    // Change pursuit state through the same fixture row, as after a saved decision.
    const rows = [opportunity("one")];
    const secondDb = new FakeWorkDb({ tables: { funding_opportunities: rows, workspaces: [{ id: workspace, time_zone: "UTC" }] }, reminderStage: "active" });
    secondDb.notifications.push(...db.notifications);
    const second = await sweepWorkDeadlines(secondDb as unknown as WorkSweepClient, options);
    expect(second.notificationsCreated).toBe(1);
    expect(second.digestsComposed).toBe(1);
    expect(secondDb.notifications.map((r) => r.kind)).toEqual(["grant_decision_due", "grant_application_due"]);
    const repeated = await sweepWorkDeadlines(secondDb as unknown as WorkSweepClient, options);
    expect(repeated.notificationsCreated).toBe(0);
    expect(repeated.digestsComposed).toBe(0);
    expect(secondDb.upsertCalls).toHaveLength(0);
    expect(secondDb.reminderWriteCalls[0].select).toBe(WORK_NOTIFICATION_WRITE_COLUMNS);
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
    // Keep the original no-swallowed-failure/no-conflict rule on the journal
    // capture body. The separate reminder RPC intentionally handles conflicts.
    const capture = source.slice(source.indexOf("CREATE FUNCTION public.record_funding_opportunity_deadline_changes()"),
      source.indexOf("CREATE FUNCTION public.keep_funding_deadline_facts_immutable()"));
    expect(capture).toContain("INSERT INTO public.work_notifications");
    expect(capture).not.toMatch(/EXCEPTION\s+WHEN|ON CONFLICT|::date|date_trunc|enqueue|http/i);
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
    expect(source.match(/SET search_path = ''/g)).toHaveLength(4);
    for (const fn of ["record_funding_opportunity_deadline_changes", "keep_funding_deadline_facts_immutable"]) {
      expect(source).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(source).toContain("RAISE EXCEPTION 'funding_deadline_change_immutable'");
    expect(source).toContain("RAISE EXCEPTION 'funding_deadline_notice_immutable'");
    expect(source).toContain("pg_catalog.to_jsonb(NEW) - ARRAY['is_read', 'read_at']");
    expect(source).toContain("RAISE EXCEPTION 'funding_opportunity_identity_immutable'");
  });
});

describe("rollout batch classification across existing award kinds", () => {
  const project = "bbbbbbbb-0000-4000-8000-00000000000b";
  const awardId = "cccccccc-0000-4000-8000-00000000000c";
  const due = "2026-10-19T01:30:00Z";
  const kinds = ["award_obligation_due", "award_expenditure_due"] as const;
  let resendKey: string | undefined;
  beforeEach(() => { resendKey = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY; });
  afterEach(() => { if (resendKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = resendKey; });

  function batch(options: Partial<FakeWorkDbOptions> = {}) {
    const award = { id: awardId, workspace_id: workspace, project_id: project, created_by: creator,
      title: "Same award", spending_status: "active", obligation_due_at: due, expenditure_deadline_at: due,
      awarded_amount: 100, match_amount: 0, match_posture: "not_required" };
    const db = new FakeWorkDb({ tables: {
      funding_awards: [award], workspaces: [{ id: workspace, time_zone: "UTC", name: "Synthetic workspace" }],
      project_deliverables: [{ id: "deliverable", project_id: project, assignee_user_id: creator, title: "Unrelated deliverable",
        due_date: "2026-10-19", status: "in_progress", projects: { id: project, workspace_id: workspace, name: "Synthetic project" } }],
    }, ...options });
    const run = () => sweepWorkDeadlines(db as unknown as WorkSweepClient, { now, horizonDays: 7,
      loadRoster: async () => ({ ok: true as const, members: [{ userId: creator, email: "synthetic@example.test", role: "member" }] }),
    });
    return { db, award, run };
  }

  it.each([null, ...kinds])("keeps unrelated delivery and explicitly defers the old-key collision, retained=%s", async (retainedKind) => {
    const { db, award, run } = batch();
    const original = { ...award };
    const retained = { workspace_id: workspace, recipient_user_id: creator, subject_table: "funding_awards", subject_id: awardId,
      kind: retainedKind, due_on: "2026-10-19", title: "Retained old title", body: "Retained old body", project_id: project };
    if (retainedKind) db.notifications.push({ ...retained });
    const result = await run();
    expect(result.writeError).toBeNull();
    expect(result.notificationsCreated).toBe(retainedKind ? 1 : 2);
    expect(result.notificationsAlreadyPresent).toBe(retainedKind ? 1 : 0);
    expect(result.deferredByOldKey).toHaveLength(1);
    const deferred = result.deferredByOldKey[0];
    expect(kinds).toContain(deferred.kind);
    expect(deferred).toMatchObject({ workspace_id: workspace, recipient_user_id: creator, subject_table: "funding_awards",
      subject_id: awardId, due_on: "2026-10-19", blockingKind: retainedKind ?? "award_obligation_due" });
    expect(deferred.kind).not.toBe(deferred.blockingKind);
    expect(result.perSource[deferred.kind]).toMatchObject({ pending: true, failed: false, candidates: 1 });
    expect(result.perSource.grant_application_due.pending).toBe(true);
    expect(db.notifications.some((row) => row.subject_id === "deliverable")).toBe(true);
    expect(db.notifications.filter((row) => row.subject_id === awardId)).toHaveLength(1);
    if (retainedKind) expect(db.notifications.find((row) => row.subject_id === awardId)).toEqual(retained);
    expect(result.digestsComposed).toBe(1);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0].payload_json).toMatchObject({ itemCount: result.notificationsCreated });
    const submitted = db.reminderWriteCalls[0].rows.filter((row) => row.subject_table === "funding_awards");
    expect(submitted.map((row) => row.kind).sort()).toEqual([...kinds].sort());
    expect(submitted.every((row) => row.subject_id === awardId && row.due_on === "2026-10-19")).toBe(true);
    const repeat = await run();
    expect(repeat).toMatchObject({ writeError: null, notificationsCreated: 0, notificationsAlreadyPresent: 2, digestsComposed: 0 });
    expect(repeat.deferredByOldKey).toEqual(result.deferredByOldKey);
    expect(db.outbox).toHaveLength(1);
    expect(award).toEqual(original);
  });

  it.each([false, true])("inserts both award kinds after activation without an arbiter race, activation during write=%s", async (activateBeforeWrite) => {
    const { db, award, run } = batch(activateBeforeWrite ? { activateBeforeWrite: true } : { reminderStage: "active" });
    const result = await run();
    expect(result).toMatchObject({ writeError: null, notificationsCreated: 3, deferredByOldKey: [], digestsComposed: 1 });
    expect(db.notifications.filter((row) => row.subject_id === awardId).map((row) => row.kind).sort()).toEqual([...kinds].sort());
    expect(db.outbox[0].payload_json).toMatchObject({ itemCount: 3 });
    expect(result.perSource.grant_application_due.pending).toBe(activateBeforeWrite);
    expect(award.obligation_due_at).toBe(due);
    expect(award.expenditure_deadline_at).toBe(due);
    expect((await run()).digestsComposed).toBe(0);
  });

  it.each([
    "null", "missing_row", "duplicate_row", "missing_kind", "missing_due", "missing_classification", "extra_field",
    "foreign_subject", "changed_date", "changed_kind", "changed_body", "unknown_classification", "missing_blocker", "same_blocker",
  ])("refuses malformed batch return %s before claiming an inserted row or composing a digest", async (fault) => {
    const { db, run } = batch({ reminderWriteResult: (rows) => {
      const changed = rows.map((row) => ({ ...row }));
      const deferred = changed.find((row) => row.classification === "deferred_old_key");
      if (fault === "null") return null;
      if (fault === "missing_row") return changed.slice(1);
      if (fault === "duplicate_row") return changed.map(() => changed[0]);
      if (fault === "missing_kind") delete changed[0].kind;
      if (fault === "missing_due") delete changed[0].due_on;
      if (fault === "missing_classification") delete changed[0].classification;
      if (fault === "extra_field") changed[0].unexpected = true;
      if (fault === "foreign_subject") changed[0].subject_id = "foreign";
      if (fault === "changed_date") changed[0].due_on = "2026-10-20";
      if (fault === "changed_kind") changed[0].kind = "award_expenditure_due";
      if (fault === "changed_body") changed[0].body = "rewritten";
      if (fault === "unknown_classification") changed[0].classification = "delivered";
      if (fault === "missing_blocker" && deferred) deferred.blocking_kind = null;
      if (fault === "same_blocker" && deferred) deferred.blocking_kind = deferred.kind;
      return changed;
    } });
    const result = await run();
    expect(result.writeError).not.toBeNull();
    expect(result).toMatchObject({ notificationsCreated: 0, notificationsAlreadyPresent: 0, deferredByOldKey: [], digestsComposed: 0 });
    expect(db.outbox).toHaveLength(0);
  });
});
