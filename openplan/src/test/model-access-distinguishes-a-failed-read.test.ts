import { describe, expect, it } from "vitest";

import { loadModelAccess } from "@/lib/models/api";

/**
 * A FAILED READ IS NOT A DENIAL, AND IT IS NOT A MISSING MODEL.
 *
 * MEASURED 2026-08-09. A mutation sample of `loadModelAccess` — the access gate
 * on all nine model routes — killed 6 of 8. Every scoping and permission
 * mutation died: dropping the caller from the membership lookup, dropping the
 * workspace, ignoring the requested action, unconditional `allowed`. That part
 * of the gate is genuinely solid.
 *
 * The two survivors were both error-swallowing, and they survived the whole
 * ~7,850-test suite. Neither is a security hole — both fail CLOSED — which is
 * exactly why nothing caught them, and exactly why they are worth closing:
 *
 *   - swallow the MEMBERSHIP error and `membership` stays null, so `allowed`
 *     computes false and every caller answers 403. A database failure tells a
 *     legitimate member of the workspace that they are forbidden.
 *   - swallow the MODEL error and `model` stays null, so every caller answers
 *     404. A database failure tells a planner their model does not exist.
 *
 * The second one is already treated as load-bearing one layer up: the model
 * detail page refuses to call `notFound()` on a read error, on the grounds that
 * "`notFound()` tells the planner their model does not exist, and a 400 or a
 * policy failure is not evidence of that." That page can only draw the
 * distinction because THIS function hands it the error. Swallowing it here
 * collapses the distinction the page deliberately preserves.
 *
 * Both are the same defect class as an errored read that returns no rows and
 * looks like a denial — a known absence and an unknown state reported as the
 * same thing.
 */

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/**
 * The chain `loadModelAccess` actually walks: `.from(t).select(c).eq(...)` once
 * for models and twice for workspace_members, then `.maybeSingle()`.
 */
function fakeClient(results: { models: Result; workspace_members?: Result }) {
  return {
    from(table: string) {
      const result =
        table === "models" ? results.models : (results.workspace_members ?? { data: null, error: null });
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  };
}

const A_MODEL = { id: MODEL_ID, workspace_id: WORKSPACE_ID, title: "Corridor screening" };

describe("loadModelAccess separates 'could not read' from 'not allowed' and 'not there'", () => {
  it("returns a MODEL read error instead of an absent model", async () => {
    const access = await loadModelAccess(
      fakeClient({ models: { data: null, error: { message: "connection reset", code: "57P01" } } }),
      MODEL_ID,
      USER_ID,
      "models.read"
    );

    // The error must reach the caller. Without it the model is simply null and
    // every route answers 404 — telling a planner their model does not exist
    // because a database call failed.
    expect(access.error).not.toBeNull();
    expect(access.error?.message).toBe("connection reset");
    expect(access.model).toBeNull();
  });

  it("returns a MEMBERSHIP read error instead of a silent denial", async () => {
    const access = await loadModelAccess(
      fakeClient({
        models: { data: A_MODEL, error: null },
        workspace_members: { data: null, error: { message: "statement timeout", code: "57014" } },
      }),
      MODEL_ID,
      USER_ID,
      "models.write"
    );

    // Without the error, `membership` is null and `allowed` is false, so the
    // caller answers 403 — telling a member of the workspace they are
    // forbidden because a query timed out.
    expect(access.error).not.toBeNull();
    expect(access.error?.message).toBe("statement timeout");
    expect(access.membership).toBeNull();
    // And it must NOT quietly report a decision it never made.
    expect(access.allowed).toBeUndefined();
  });

  it("reports a genuinely absent model with no error", async () => {
    // The other half of the distinction: a model that really is not there is a
    // known absence, and must not be dressed up as a failure either.
    const access = await loadModelAccess(
      fakeClient({ models: { data: null, error: null } }),
      MODEL_ID,
      USER_ID,
      "models.read"
    );

    expect(access.error).toBeNull();
    expect(access.model).toBeNull();
  });

  it("reports a genuine denial with no error", async () => {
    const access = await loadModelAccess(
      fakeClient({
        models: { data: A_MODEL, error: null },
        workspace_members: { data: null, error: null },
      }),
      MODEL_ID,
      USER_ID,
      "models.write"
    );

    expect(access.error).toBeNull();
    expect(access.model).not.toBeNull();
    expect(access.membership).toBeNull();
    expect(access.allowed).toBe(false);
  });

  it("still allows a member with a sufficient role", async () => {
    // The positive case, so none of the assertions above can be satisfied by a
    // gate that refuses everything.
    const access = await loadModelAccess(
      fakeClient({
        models: { data: A_MODEL, error: null },
        workspace_members: { data: { workspace_id: WORKSPACE_ID, role: "admin" }, error: null },
      }),
      MODEL_ID,
      USER_ID,
      "models.write"
    );

    expect(access.error).toBeNull();
    expect(access.allowed).toBe(true);
  });
});
