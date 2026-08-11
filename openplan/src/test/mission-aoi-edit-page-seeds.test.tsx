import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AoiSeedSource } from "@/lib/aerial/aoi-seed";

/**
 * Lane E1, the page half — the AOI edit page LOADS the project's geometry and
 * THREADS it into the editor.
 *
 * The editor's own seed tests prove the affordance works when seedSources
 * arrive; this file proves they arrive. Without it, a page that never selects
 * `project_id` or never passes the prop leaves the entire capability shipped
 * and invisible (this repo's recurring defect class) while every other test
 * stays green.
 *
 * The editor is stubbed here deliberately: the subject is the page's data
 * loading and prop threading, and the real editor is covered by
 * mission-aoi-seed-editor.test.tsx.
 */

const MISSION_ID = "11111111-1111-4111-8111-111111111111";

const capturedEditorProps: { seedSources?: AoiSeedSource[] }[] = [];

vi.mock("@/components/aerial/mission-aoi-editor", () => ({
  MissionAoiEditor: (props: { seedSources?: AoiSeedSource[] }) => {
    capturedEditorProps.push(props);
    return <div data-testid="mission-aoi-editor" />;
  },
}));

const loadCurrentWorkspaceMembershipMock = vi.fn(async (..._args: unknown[]) => ({
  membership: { workspace_id: "ws-1" },
}));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) =>
    loadCurrentWorkspaceMembershipMock(...args),
}));

type TableFixtures = {
  mission: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  corridors: Record<string, unknown>[];
};

const selectByTable: Record<string, string[]> = {};
const tablesQueried: string[] = [];
let fixtures: TableFixtures;

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from(table: string) {
      tablesQueried.push(table);
      return {
        select(projection: string) {
          (selectByTable[table] ??= []).push(projection);
          const single = { maybeSingle: async () => ({ data: tableRow(table), error: null }) };
          const eqTwice = { eq: () => ({ ...single, order: async () => ({ data: fixtures.corridors, error: null }) }) };
          return { eq: () => eqTwice };
        },
      };
    },
  };
}

function tableRow(table: string) {
  if (table === "aerial_missions") return fixtures.mission;
  if (table === "projects") return fixtures.project;
  throw new Error(`Unexpected maybeSingle on table: ${table}`);
}

const createClientMock = vi.fn(async () => fakeSupabase());
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

async function renderPage() {
  const { default: EditMissionAoiPage } = await import(
    "@/app/(app)/aerial/missions/[missionId]/edit/page"
  );
  const ui = await EditMissionAoiPage({ params: Promise.resolve({ missionId: MISSION_ID }) });
  return render(ui);
}

beforeEach(() => {
  capturedEditorProps.length = 0;
  tablesQueried.length = 0;
  for (const key of Object.keys(selectByTable)) delete selectByTable[key];
  fixtures = {
    mission: {
      id: MISSION_ID,
      workspace_id: "ws-1",
      project_id: "proj-9",
      title: "Bridge approach flight",
      aoi_geojson: null,
    },
    project: {
      id: "proj-9",
      name: "Bridge Rehab",
      place_label: "Elk Meadow",
      place_geometry_geojson: {
        type: "Polygon",
        coordinates: [
          [
            [-100.02, 40.0],
            [-100.0, 40.0],
            [-100.0, 40.02],
            [-100.02, 40.02],
            [-100.02, 40.0],
          ],
        ],
      },
    },
    corridors: [
      {
        id: "c-77",
        name: "River Road",
        geometry_geojson: { type: "LineString", coordinates: [[-100, 40], [-99.99, 40]] },
      },
    ],
  };
});

describe("mission AOI edit page seeds the editor from project geometry", () => {
  it("asks the mission row for project_id — the column the whole seed path hangs on", async () => {
    await renderPage();
    expect(selectByTable["aerial_missions"]?.[0]).toContain("project_id");
  });

  it("threads the project boundary and each corridor into the editor, labeled from the data", async () => {
    await renderPage();
    expect(capturedEditorProps).toHaveLength(1);
    const seeds = capturedEditorProps[0].seedSources ?? [];
    expect(seeds).toHaveLength(2);

    const boundary = seeds.find((s) => s.kind === "project_boundary");
    expect(boundary?.label).toBe("Elk Meadow"); // place_label, not a constant
    if (boundary?.kind === "project_boundary") {
      expect(boundary.ring).toHaveLength(4); // open ring from the fixture polygon
    }

    const corridor = seeds.find((s) => s.kind === "corridor");
    expect(corridor?.label).toBe("River Road");
    expect(corridor?.key).toBe("corridor-c-77");
  });

  it("passes no seeds — and queries no project tables — for a projectless mission", async () => {
    fixtures.mission = { ...fixtures.mission!, project_id: null };
    await renderPage();
    expect(capturedEditorProps).toHaveLength(1);
    expect(capturedEditorProps[0].seedSources).toEqual([]);
    expect(tablesQueried).not.toContain("projects");
    expect(tablesQueried).not.toContain("project_corridors");
  });
});
