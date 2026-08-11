import fs from "node:fs";
import path from "node:path";

import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createClientMock(),
  createServiceRoleClient: () => {
    throw new Error("the reminder panel must not read with the service role");
  },
}));

import MyWorkLayout from "@/app/(app)/my-work/layout";

import { FakeWorkDb } from "./helpers/fake-work-notification-tables";
import { stripSourceComments } from "./helpers/source-text";

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
 * fails the first test; swapping the read to a service-role client fails the
 * second.
 */

const ALICE = "aaaaaaaa-0000-4000-8000-00000000000a";
const LAYOUT_PATH = "src/app/(app)/my-work/layout.tsx";
/** Distinctive on purpose: the assertion below is that it never reaches the DOM. */
const CRON_SECRET_FIXTURE = "zzq-operator-only-token";

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

let savedSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON_SECRET_FIXTURE;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
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

    // Only the BOOLEAN crosses to the client. The layout reads CRON_SECRET to
    // decide whether the sweep can run at all; shipping the value itself into a
    // client component's props would put an operator secret in the page source.
    expect(document.body.innerHTML).not.toContain(CRON_SECRET_FIXTURE);
  });

  it("reads with the caller's own client, so the row-level policy is the access control", async () => {
    const fake = db();
    createClientMock.mockReturnValue(fake);

    await MyWorkLayout({ children: <div /> });

    const read = fake.reads.find((entry) => entry.table === "work_notifications");
    expect(read, "the layout never read the reminders at all").toBeDefined();
    // Scoped to this caller AND to unread, at the database.
    expect(read?.filters).toContainEqual({ kind: "eq", column: "recipient_user_id", value: ALICE });
    expect(read?.filters).toContainEqual({ kind: "eq", column: "is_read", value: false });

    // The grep half, on the code and not on the prose: the document-library
    // precedent. The throwing mock above catches a call; this catches an import
    // that has not been called yet.
    const source = stripSourceComments(
      fs.readFileSync(path.join(process.cwd(), LAYOUT_PATH), "utf8")
    );
    expect(source).not.toContain("createServiceRoleClient");
  });

  it("reads nothing for a signed-out visitor and still renders the page beneath", async () => {
    const fake = db();
    fake.auth.getUser = async () => ({ data: { user: null } }) as never;
    createClientMock.mockReturnValue(fake);

    render(await MyWorkLayout({ children: <div data-testid="queue">the queue</div> }));

    expect(fake.reads.find((entry) => entry.table === "work_notifications")).toBeUndefined();
    expect(screen.getByTestId("queue")).toBeTruthy();
  });

  it("tells a signed-in planner when the sweep cannot run on this deployment", async () => {
    delete process.env.CRON_SECRET;
    const fake = new FakeWorkDb({ tables: { work_notifications: [] } });
    createClientMock.mockReturnValue(
      Object.assign(fake, {
        auth: { ...fake.auth, getUser: async () => ({ data: { user: { id: ALICE } } }) },
      })
    );

    render(await MyWorkLayout({ children: <div /> }));

    expect(document.body.textContent ?? "").toContain("switched off");
  });
});
