import { describe, expect, it } from "vitest";

import {
  projectDeleteRefusalBody,
  readProjectDeleteOutcome,
} from "@/lib/projects/project-delete-outcome";
import { PROJECT_DELETE_RELATIONS } from "@/lib/projects/project-delete-preconditions";

/**
 * THE BRANCH NOTHING WATCHED.
 *
 * Deleting a project counts every table that references it and refuses if any
 * of them has rows. The dangerous case is not a full table — it is a table the
 * count could not READ. Reading a failed count as zero deletes rows nobody
 * looked at, and `projects` cascades into sixteen tables.
 *
 * The route has always handled it. Nothing tested it: no suite reached the
 * 503 branch, and a mutation that deleted the check outright left every project
 * test green. That was true before this counting moved into
 * `readProjectDeleteOutcome`, and it is the reason the move was worth making —
 * the branch is now reachable from a unit test instead of only through an
 * authenticated route.
 *
 * The pre-flight the delete dialog calls shares this function with the DELETE
 * route, so this also fixes the answer a planner is shown: "OpenPlan cannot
 * confirm what is attached" rather than a confirm button over an unchecked
 * delete.
 */

type Row = { count: number | null; error: { message: string; code?: string } | null };

/** The two chained shapes `countReferences` and the constrained-costed count use. */
function fakeSupabase(answers: Record<string, Row>, fallback: Row = { count: 0, error: null }) {
  const read: string[] = [];
  const client = {
    from(table: string) {
      read.push(table);
      const answer = answers[table] ?? fallback;
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => Promise.resolve(answer),
        then: (resolve: (value: Row) => unknown) => Promise.resolve(answer).then(resolve),
      };
      return chain;
    },
  };
  return { client: client as never, read };
}

describe("what deleting a project would cost", () => {
  it("refuses to answer at all when a referencing table cannot be read", async () => {
    const blind = PROJECT_DELETE_RELATIONS[0].table;
    const { client } = fakeSupabase({
      [blind]: { count: null, error: { message: "permission denied for table", code: "42501" } },
    });

    const outcome = await readProjectDeleteOutcome({ supabase: client, projectId: "p1" });

    // Not "deletable". Not "refused" with a list. "We cannot say" — because the
    // alternative is destroying work this check never saw.
    expect(outcome.kind).toBe("unreadable");
    if (outcome.kind !== "unreadable") throw new Error("unreachable");
    expect(outcome.tables).toContain(blind);
    expect(outcome.messages.join(" ")).toContain("permission denied for table");
  });

  it("reads every relation that references a project, not a sample of them", async () => {
    const { client, read } = fakeSupabase({});

    await readProjectDeleteOutcome({ supabase: client, projectId: "p1" });

    // A relation missing from the sweep is a table whose rows a delete would
    // destroy without ever mentioning them.
    for (const relation of PROJECT_DELETE_RELATIONS) {
      expect(read, `never counted ${relation.table}`).toContain(relation.table);
    }
  });

  it("says deletable only when every relation was read and every one was empty", async () => {
    const { client } = fakeSupabase({});

    const outcome = await readProjectDeleteOutcome({ supabase: client, projectId: "p1" });

    expect(outcome.kind).toBe("deletable");
  });

  it("refuses, and names what is attached, when a relation has rows", async () => {
    const populated = PROJECT_DELETE_RELATIONS[0].table;
    const { client } = fakeSupabase({ [populated]: { count: 3, error: null } });

    const outcome = await readProjectDeleteOutcome({ supabase: client, projectId: "p1" });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("unreachable");
    expect(outcome.assessment.blockers.map((blocker) => blocker.table)).toContain(populated);
    // The refusal points somewhere reversible instead of stopping at "no".
    expect(outcome.assessment.alternative).not.toBe("");
  });

  it("hands the pre-flight and the DELETE route the same refusal body, links included", async () => {
    const populated = PROJECT_DELETE_RELATIONS[0].table;
    const { client } = fakeSupabase({ [populated]: { count: 3, error: null } });

    const outcome = await readProjectDeleteOutcome({ supabase: client, projectId: "p1" });
    if (outcome.kind !== "refused") throw new Error("expected a refusal");
    const body = projectDeleteRefusalBody(outcome.assessment);

    // Both surfaces answer with THIS, so a field dropped here is a field dropped
    // in two places at once. The href is the one a planner acts on: a blocker
    // they cannot navigate to is a refusal they have to go and hunt for.
    const blocker = body.blockers.find((candidate) => candidate.table === populated)!;
    expect(blocker.href).toBe(
      PROJECT_DELETE_RELATIONS.find((relation) => relation.table === populated)!.href
    );
    expect(blocker.href).not.toBe("");
    expect(blocker.reason).toEqual(expect.any(String));
    expect(body.headline).toBe(outcome.assessment.headline);
    expect(body.alternative).toBe(outcome.assessment.alternative);
  });
});
