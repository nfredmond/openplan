import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { describeDeletionRefusal } from "@/lib/workspace-gis/references";

/**
 * A LAYER SOMETHING ELSE IS USING IS NOT A LAYER YOU CAN DELETE.
 *
 * The usual shape of this defect is a confirmation dialog: "Delete this layer?
 * This cannot be undone." That asks the planner a question only the database
 * can answer, and the cost of the wrong answer is an adopted plan or a live
 * public map that stops resolving. So the refusal names what would break, by
 * name, and offers archiving — and the delete is refused whether or not
 * anything asked first, because the foreign key in 20260812000018 takes no
 * destructive action.
 *
 * WHAT THIS TEST CANNOT SEE, stated so nobody reads more into it: nothing
 * writes `workspace_gis_layer_references` yet — adoption into an engagement
 * campaign is a later phase — so in a live deployment today the table is empty
 * and a delete succeeds. The mechanism ships first deliberately, so the first
 * adopter inherits it rather than having to remember to build it.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const layerMaybeSingleMock = vi.fn();
const referencesOrderMock = vi.fn();
const deleteEqSecondMock = vi.fn();

let deleteAttempted = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
    workspace: null,
  }),
}));

import { DELETE } from "@/app/api/workspace-gis/layers/[layerId]/route";

const LAYER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function layerRow() {
  return {
    id: LAYER_ID,
    workspace_id: "33333333-3333-4333-8333-333333333333",
    project_id: null,
    name: "Bike network",
    description: null,
    display_color: "#94a3b8",
    display_opacity: 0.8,
    display_line_width: 1.5,
    label_field: null,
    default_visible: false,
    sort_order: 0,
    current_version_id: null,
    archived_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
    current_version: null,
  };
}

function fakeClient() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      if (table === "workspace_gis_layers") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: layerMaybeSingleMock }) }),
          delete: () => ({
            eq: () => ({
              eq: () => ({
                // `.select("id")` is part of the real chain: the delete has to
                // be able to see whether it removed anything.
                select: (...args: unknown[]) => {
                  deleteAttempted = true;
                  return deleteEqSecondMock(...args);
                },
              }),
            }),
          }),
        };
      }
      if (table === "workspace_gis_layer_references") {
        return {
          select: () => ({ eq: () => ({ order: referencesOrderMock }) }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const context = () => ({ params: Promise.resolve({ layerId: LAYER_ID }) });
const request = () =>
  new NextRequest(`http://localhost/api/workspace-gis/layers/${LAYER_ID}`, { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  deleteAttempted = false;
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  layerMaybeSingleMock.mockResolvedValue({ data: layerRow(), error: null });
  deleteEqSecondMock.mockResolvedValue({ data: [{ id: LAYER_ID }], error: null });
  createClientMock.mockResolvedValue(fakeClient());
});

describe("the refusal sentence", () => {
  it("names the adopters rather than counting them", () => {
    const message = describeDeletionRefusal("Bike network", [
      {
        id: "r1",
        kind: "engagement_campaign",
        referenceId: "c1",
        label: "Downtown Circulation Study",
        href: "/engagement/c1",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    expect(message).toContain("Bike network");
    expect(message).toContain("Downtown Circulation Study");
    expect(message).toContain("engagement campaign");
    // The alternative that keeps the citation resolving is part of the refusal,
    // not a separate discovery the planner has to make.
    expect(message).toContain("Archive it");
  });

  it("summarises a long list without losing the first names", () => {
    const references = Array.from({ length: 5 }, (_, index) => ({
      id: `r${index}`,
      kind: "report" as const,
      referenceId: `x${index}`,
      label: `Report ${index}`,
      href: `/reports/x${index}`,
      createdAt: "2026-08-01T00:00:00.000Z",
    }));

    const message = describeDeletionRefusal("Parcels", references);
    expect(message).toContain("Report 0");
    expect(message).toContain("2 more");
  });
});

describe("DELETE /api/workspace-gis/layers/[layerId]", () => {
  it("refuses, names what uses the layer, and does not attempt the delete", async () => {
    referencesOrderMock.mockResolvedValue({
      data: [
        {
          id: "r1",
          reference_kind: "engagement_campaign",
          reference_id: "c1",
          reference_label: "Downtown Circulation Study",
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await DELETE(request(), context());
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.deletable).toBe(false);
    expect(body.error).toContain("Downtown Circulation Study");
    // Each reference comes back with a link, so the dialog is actionable.
    expect(body.references[0].href).toBe("/engagement/c1");
    expect(deleteAttempted, "a refused delete must not reach the table").toBe(false);
  });

  it("deletes a layer nothing has adopted", async () => {
    referencesOrderMock.mockResolvedValue({ data: [], error: null });

    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(deleteAttempted).toBe(true);
  });

  /**
   * A READ THAT FAILED ESTABLISHES NOTHING.
   *
   * The dangerous branch: if the reference lookup errors and the route treats
   * its empty result as "nothing uses this", every failed read becomes a
   * licence to delete an adopted layer. Same class as the census-tract scope
   * failure that reserved "no home geography set" for a read that SUCCEEDED.
   */
  it("does not delete when it could not find out what uses the layer", async () => {
    referencesOrderMock.mockResolvedValue({
      data: null,
      error: { message: "connection reset", code: "08006" },
    });

    const response = await DELETE(request(), context());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("could not check");
    expect(deleteAttempted, "an unknown must never be read as 'nothing uses it'").toBe(false);
  });

});
