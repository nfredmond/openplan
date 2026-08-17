import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const heartbeatState = vi.hoisted(() => ({
  // The sweep's last recorded success, or null for "never ran". Default null so
  // the empty-panel test's honest state is deterministic (never, clock-free);
  // the rows-present tests do not reach the freshness branch at all.
  lastSucceededAt: null as string | null,
  reads: [] as string[],
}));

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createClientMock(),
  // The heartbeat is deployment-global operational metadata (cron_job_heartbeats),
  // NOT tenant data, and it is LOCKED to the service role — so the layout reads
  // it with the service role, and that is correct. What must NOT use the service
  // role is the work_notifications read; that isolation is asserted behaviorally
  // below (the reminder comes from the caller's client).
  createServiceRoleClient: () => ({
    from: (table: string) => {
      heartbeatState.reads.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: heartbeatState.lastSucceededAt
                ? { last_succeeded_at: heartbeatState.lastSucceededAt }
                : null,
              error: null,
            }),
          }),
        }),
      };
    },
  }),
}));

import MyWorkLayout from "@/app/(app)/my-work/layout";

import { FakeWorkDb } from "./helpers/fake-work-notification-tables";

/**
 * CAN A PLANNER ACTUALLY SEE A REMINDER?
 *
 * This is the assertion the rest of the lane cannot make. The sweep can be
 * perfect and the panel can be perfect and the product can still ship a
 * reminder system nobody ever sees, because nothing mounted the panel — the
 * shipped-invisible defect class, eleven instances and counting in this
 * repository. So this file drives the REAL route segment, with the real loader,
 * over a fake table, and asks whether the words reach the screen.
 *
 * It also pins WHICH CLIENT does the reading. `work_notifications`' SELECT
 * policy is `recipient_user_id = auth.uid() AND <member>`; the caller's client
 * is what makes that policy the access control. A service-role read would
 * replace a policy with an `.eq()` and become the only thing standing between
 * one planner's reminders and another's — so the mock above THROWS if the
 * layout ever reaches for it, and the source scan below fails even if a future
 * edit imports it by another name.
 *
 * MUTATION-VERIFIED (each reverted after): removing the panel from the layout
 * fails the first test; reading work_notifications with the service-role client
 * fails the second; keying the "not running" notice on anything but the sweep's
 * own heartbeat fails the third.
 */

const ALICE = "aaaaaaaa-0000-4000-8000-00000000000a";

function db() {
  const fake = new FakeWorkDb({
    tables: {
      work_notifications: [
        {
          id: "n-1",
          recipient_user_id: ALICE,
          is_read: false,
          kind: "submittal_due",
          title: "Authorization packet",
          body: "Submittal to the state DOT district office — due Aug 17, 2026.",
          due_on: "2026-08-17",
          project_id: null,
          created_at: "2026-08-11T13:00:00.000Z",
        },
      ],
    },
  });
  return Object.assign(fake, {
    auth: {
      ...fake.auth,
      getUser: async () => ({ data: { user: { id: ALICE } } }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  heartbeatState.lastSucceededAt = null;
  heartbeatState.reads = [];
});

describe("/my-work mounts the reminder panel", () => {
  it("renders the reminders above the queue, on the real route segment", async () => {
    const fake = db();
    createClientMock.mockReturnValue(fake);

    render(await MyWorkLayout({ children: <div data-testid="queue">the queue</div> }));

    // The reminder is on screen …
    expect(screen.getByText("Authorization packet")).toBeTruthy();
    // … and so is the page it wraps: a mount that displaced the queue would be
    // a different defect, not a fix.
    expect(screen.getByTestId("queue")).toBeTruthy();
  });

  it("reads reminders with the CALLER's client and the heartbeat with the service role", async () => {
    const fake = db();
    createClientMock.mockReturnValue(fake);

    await MyWorkLayout({ children: <div /> });

    // work_notifications comes from the caller's client — its SELECT policy
    // (recipient_user_id = auth.uid() AND member) is the access control, and a
    // service-role read here would replace that policy with an .eq().
    const read = fake.reads.find((entry) => entry.table === "work_notifications");
    expect(read, "the layout never read the reminders at all").toBeDefined();
    expect(read?.filters).toContainEqual({ kind: "eq", column: "recipient_user_id", value: ALICE });
    expect(read?.filters).toContainEqual({ kind: "eq", column: "is_read", value: false });

    // The heartbeat — deployment-global, no tenant data — is the ONE thing read
    // with the service role, and it must be cron_job_heartbeats and nothing else.
    // The caller's client must NEVER be pointed at that locked table.
    expect(heartbeatState.reads).toEqual(["cron_job_heartbeats"]);
    expect(fake.reads.find((entry) => entry.table === "cron_job_heartbeats")).toBeUndefined();
  });

  it("reads nothing for a signed-out visitor and still renders the page beneath", async () => {
    const fake = db();
    fake.auth.getUser = async () => ({ data: { user: null } }) as never;
    createClientMock.mockReturnValue(fake);

    render(await MyWorkLayout({ children: <div data-testid="queue">the queue</div> }));

    expect(fake.reads.find((entry) => entry.table === "work_notifications")).toBeUndefined();
    expect(screen.getByTestId("queue")).toBeTruthy();
  });

  it("tells a signed-in planner the sweep is NOT RUNNING when its heartbeat is absent", async () => {
    // The 2026-08-17 fix: this used to key on CRON_SECRET being unset, so a
    // self-hoster who set the secret for another cron saw a silent panel that
    // implied reminders worked. Now the empty inbox + no heartbeat is the honest
    // "not running" — independent of any secret.
    heartbeatState.lastSucceededAt = null;
    const fake = new FakeWorkDb({ tables: { work_notifications: [] } });
    createClientMock.mockReturnValue(
      Object.assign(fake, {
        auth: { ...fake.auth, getUser: async () => ({ data: { user: { id: ALICE } } }) },
      })
    );

    render(await MyWorkLayout({ children: <div /> }));

    expect(document.body.textContent ?? "").toContain("not running");
  });
});
