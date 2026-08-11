import { describe, expect, it } from "vitest";

import {
  ASSIGNEE_EMAIL_UNAVAILABLE_LABEL,
  ASSIGNEE_ROSTER_UNAVAILABLE_SENTENCE,
  describeRecordAssignee,
  type ProjectAssigneeRoster,
} from "@/components/projects/record-assignee";
import { DEPARTED_ASSIGNEE_SENTENCE } from "@/lib/workspaces/roster";

/**
 * The one function every project surface uses to turn an assignee id into
 * something a planner reads. Rendered coverage of it lives in
 * project-detail-page.test.tsx, through the real board; this file pins the
 * cases that are hard to stage in a page render and easy to collapse into each
 * other in a refactor.
 *
 * FOUR INPUTS LOOK LIKE "NO NAME" AND MEAN DIFFERENT THINGS: the column was not
 * selected, nobody is assigned, the person left, the roster could not be read.
 * Only the last two produce words, and they are not the same words.
 */

const MEMBER = { userId: "user-2", email: "priya@example.gov", role: "member" };
const ROSTER: ProjectAssigneeRoster = { ok: true, members: [MEMBER] };
const UNREADABLE: ProjectAssigneeRoster = { ok: false };

describe("describeRecordAssignee", () => {
  it("names the member", () => {
    expect(describeRecordAssignee(ROSTER, "user-2")).toEqual({
      text: "priya@example.gov",
      tone: "info",
    });
  });

  it("says the email is unavailable rather than rendering a bare uuid at a planner", () => {
    const roster: ProjectAssigneeRoster = { ok: true, members: [{ ...MEMBER, email: null }] };
    expect(describeRecordAssignee(roster, "user-2")?.text).toBe(ASSIGNEE_EMAIL_UNAVAILABLE_LABEL);
  });

  it("uses the shared departed sentence for an id that is no longer on the roster", () => {
    // Shared, not restated: the picker, the board and the work queues all have
    // to say the same thing about the same person.
    expect(describeRecordAssignee(ROSTER, "user-gone")).toEqual({
      text: DEPARTED_ASSIGNEE_SENTENCE,
      tone: "warning",
    });
  });

  it("refuses to call anyone departed when the roster itself could not be read", () => {
    expect(describeRecordAssignee(UNREADABLE, "user-2")).toEqual({
      text: ASSIGNEE_ROSTER_UNAVAILABLE_SENTENCE,
      tone: "warning",
    });
    // Even for an id that IS on the real roster: an unreadable roster knows
    // nothing about anybody.
    expect(describeRecordAssignee(UNREADABLE, "user-gone")?.text).toBe(
      ASSIGNEE_ROSTER_UNAVAILABLE_SENTENCE
    );
  });

  it("stays silent when there is nothing to say", () => {
    // Nobody assigned — and owner_label, rendered separately, may still name
    // whoever is on the hook.
    expect(describeRecordAssignee(ROSTER, null)).toBeNull();
    // The column was not in the projection (a deployment behind the migration).
    // Silence here; the panel discloses the pending schema once.
    expect(describeRecordAssignee(ROSTER, undefined)).toBeNull();
    // A failed roster read says nothing about a record nobody was assigned to.
    expect(describeRecordAssignee(UNREADABLE, null)).toBeNull();
    expect(describeRecordAssignee(UNREADABLE, undefined)).toBeNull();
  });
});
