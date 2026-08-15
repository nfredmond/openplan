import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExploreStudyAreaPanel } from "@/app/(app)/explore/_components/explore-study-area-panel";
import { canRunAnalysis } from "@/app/(app)/explore/_components/explore-page-state";
import type { CorridorGeometry, HomeGeographyLoadState } from "@/app/(app)/explore/_components/_types";
import { resolveStudyArea, type ResolvedStudyArea } from "@/lib/models/study-area";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import {
  placeOfRecordFromHomeGeography,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";

/**
 * Analysis Studio used to accept exactly one kind of study area: a `.geojson`
 * file from disk. This suite is about the promise that replaced it — a boundary
 * is a boundary, whichever of the three ways set it, and the run gate cannot
 * tell them apart.
 *
 * It now also pins the second half of that promise: an area the planner did not
 * pick has to SAY where it came from. An inherited area can be the project's or
 * the workspace's, those are different places, and a boundary shown without its
 * origin lets a county-wide study pass for a corridor-scoped one.
 *
 * The geometries below are fixtures, not places the code knows about. Nothing in
 * `src/` names a jurisdiction; that is the point of the picker these tests stand
 * in for.
 */
const fixtures = vi.hoisted(() => ({
  searched: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-83.2, 39.8],
        [-82.8, 39.8],
        [-82.8, 40.1],
        [-83.2, 40.1],
        [-83.2, 39.8],
      ],
    ],
  },
  drawn: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-97.9, 30.1],
        [-97.5, 30.1],
        [-97.5, 30.4],
        [-97.9, 30.4],
        [-97.9, 30.1],
      ],
    ],
  },
  uploaded: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-71.2, 42.3],
        [-70.9, 42.3],
        [-70.9, 42.5],
        [-71.2, 42.5],
        [-71.2, 42.3],
      ],
    ],
  },
}));

// Stand in for the shared any-US-place picker, which is Mapbox-backed and
// TIGERweb-fed. The buttons are the two things it can produce — a searched
// place and a hand-drawn area — plus clearing, which is how a planner backs out.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({
    corridorText,
    onCorridorChange,
    externalLabel,
  }: {
    corridorText: string;
    onCorridorChange: (text: string) => void;
    externalLabel?: string | null;
  }) => (
    <div>
      <span data-testid="picker-text">{corridorText}</span>
      <span data-testid="picker-external-label">{externalLabel ?? ""}</span>
      <button type="button" onClick={() => onCorridorChange(JSON.stringify(fixtures.searched))}>
        search-a-place
      </button>
      <button type="button" onClick={() => onCorridorChange(JSON.stringify(fixtures.drawn))}>
        draw-an-area
      </button>
      <button type="button" onClick={() => onCorridorChange("")}>
        clear-the-area
      </button>
    </div>
  ),
}));

const QUERY = "Assess safety, access, and equity conditions for this study area.";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

/** Nothing to inherit: what the panel gets when neither owner states an area. */
const NOTHING_INHERITED = resolveStudyArea({});

/** Mirrors the page: the study area lives above the panel, both inputs write it. */
function Harness({
  studyArea = NOTHING_INHERITED,
  homeGeographyLoadState = "loaded",
  initialGeometry = null,
  openedForProject = null,
  projectAreaNotice = null,
  onChange,
}: {
  studyArea?: ResolvedStudyArea;
  homeGeographyLoadState?: HomeGeographyLoadState;
  initialGeometry?: CorridorGeometry | null;
  openedForProject?: { id: string; name: string | null } | null;
  projectAreaNotice?: string | null;
  onChange?: (geometry: CorridorGeometry | null) => void;
}) {
  const [corridorGeojson, setCorridorGeojson] = useState<CorridorGeometry | null>(initialGeometry);
  return (
    <ExploreStudyAreaPanel
      corridorGeojson={corridorGeojson}
      onCorridorChange={(geometry) => {
        onChange?.(geometry);
        setCorridorGeojson(geometry);
      }}
      studyArea={studyArea}
      homeGeographyLoadState={homeGeographyLoadState}
      openedForProject={openedForProject}
      projectAreaNotice={projectAreaNotice}
    />
  );
}

function uploadBoundaryFile(geometry: unknown, name = "corridor.geojson") {
  const file = new File([JSON.stringify(geometry)], name, { type: "application/geo+json" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

/** A workspace that has stated where it works. Synthetic — no real GEOID. */
function homeGeography(over: Partial<WorkspaceHomeGeography> = {}): WorkspaceHomeGeography {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "99999",
    home_geography_label: "Example County, ZZ",
    home_country_code: "US",
    home_subdivision_code: "ZZ",
    home_min_lon: -83.2,
    home_min_lat: 39.8,
    home_max_lon: -82.8,
    home_max_lat: 40.1,
    home_geometry_geojson: fixtures.searched,
    home_geography_set_at: "2026-07-27T00:00:00.000Z",
    ...over,
  };
}

/** The same precedence the page applies, so these fixtures cannot drift from it. */
function inheritedFromHome(): ResolvedStudyArea {
  return resolveStudyArea({ workspaceHome: placeOfRecordFromHomeGeography(homeGeography()) });
}

function inheritedFromProject(over: Record<string, unknown> = {}): ResolvedStudyArea {
  return resolveStudyArea({
    project: placeOfRecordFromProject({
      place_source: "tigerweb",
      place_kind: "city",
      place_ref: "9999999",
      place_label: "Example City, ZZ",
      place_country_code: "US",
      place_subdivision_code: "ZZ",
      place_min_lon: -97.9,
      place_min_lat: 30.1,
      place_max_lon: -97.5,
      place_max_lat: 30.4,
      place_geometry_geojson: fixtures.drawn,
      place_set_at: "2026-07-28T00:00:00.000Z",
      ...over,
    }),
    workspaceHome: placeOfRecordFromHomeGeography(homeGeography()),
  });
}

describe("Explore study area panel", () => {
  it("turns a searched place into the analysis geometry and opens the run gate", () => {
    const changes: Array<CorridorGeometry | null> = [];
    render(<Harness onChange={(geometry) => changes.push(geometry)} />);

    expect(screen.getByText("No study area yet")).toBeInTheDocument();
    expect(
      canRunAnalysis({ workspaceId: WORKSPACE_ID, queryText: QUERY, corridorGeojson: null })
    ).toBe(false);

    fireEvent.click(screen.getByText("search-a-place"));

    expect(changes.at(-1)).toEqual(fixtures.searched);
    expect(
      canRunAnalysis({ workspaceId: WORKSPACE_ID, queryText: QUERY, corridorGeojson: changes.at(-1)! })
    ).toBe(true);
    expect(screen.getByText("Study area set")).toBeInTheDocument();
    // The text handed back is byte-identical to the text the picker emitted.
    // The picker treats anything else as an area it did not choose and drops its
    // own place label, so a lossy round trip would quietly rename the place.
    expect(screen.getByTestId("picker-text").textContent).toBe(JSON.stringify(fixtures.searched));
  });

  it("treats a drawn area exactly like a searched place", () => {
    const changes: Array<CorridorGeometry | null> = [];
    render(<Harness onChange={(geometry) => changes.push(geometry)} />);

    fireEvent.click(screen.getByText("draw-an-area"));

    expect(changes.at(-1)).toEqual(fixtures.drawn);
    expect(
      canRunAnalysis({ workspaceId: WORKSPACE_ID, queryText: QUERY, corridorGeojson: changes.at(-1)! })
    ).toBe(true);
  });

  it("still accepts an uploaded boundary file", async () => {
    const changes: Array<CorridorGeometry | null> = [];
    render(<Harness onChange={(geometry) => changes.push(geometry)} />);

    uploadBoundaryFile(fixtures.uploaded);

    await waitFor(() => expect(changes.at(-1)).toEqual(fixtures.uploaded));
    expect(
      canRunAnalysis({ workspaceId: WORKSPACE_ID, queryText: QUERY, corridorGeojson: changes.at(-1)! })
    ).toBe(true);
    expect(screen.getByText("Boundary loaded")).toBeInTheDocument();
    // Whatever set the area, the picker shows it — there is one boundary here.
    expect(screen.getByTestId("picker-text")).toHaveTextContent(JSON.stringify(fixtures.uploaded));
  });

  it("stops calling the uploaded file the boundary once a place replaces it", async () => {
    render(<Harness />);

    uploadBoundaryFile(fixtures.uploaded);
    await waitFor(() => expect(screen.getByText("Boundary loaded")).toBeInTheDocument());

    fireEvent.click(screen.getByText("search-a-place"));

    expect(screen.getByText("Not the area in use")).toBeInTheDocument();
    expect(screen.getByText("Last uploaded file")).toBeInTheDocument();
    expect(screen.getByText("corridor.geojson")).toBeInTheDocument();
  });

  it("clears the analysis geometry when the picker clears the area", () => {
    const changes: Array<CorridorGeometry | null> = [];
    render(<Harness onChange={(geometry) => changes.push(geometry)} />);

    fireEvent.click(screen.getByText("search-a-place"));
    fireEvent.click(screen.getByText("clear-the-area"));

    expect(changes.at(-1)).toBeNull();
    expect(screen.getByText("No study area yet")).toBeInTheDocument();
    expect(
      canRunAnalysis({ workspaceId: WORKSPACE_ID, queryText: QUERY, corridorGeojson: null })
    ).toBe(false);
  });

  it("opens on the workspace's home geography, named and attributed, when one is set", () => {
    const studyArea = inheritedFromHome();
    render(<Harness studyArea={studyArea} initialGeometry={studyArea.geometry} />);

    expect(screen.getByTestId("picker-text")).toHaveTextContent(JSON.stringify(fixtures.searched));
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Example County, ZZ");
    expect(
      screen.getByText(/Prefilled from this workspace's home geography \(Example County, ZZ\)/)
    ).toBeInTheDocument();
    expect(screen.getByText("Study area set")).toBeInTheDocument();
  });

  it("says the area came from the project, by name, when the project outranked the workspace", () => {
    const studyArea = inheritedFromProject();
    render(
      <Harness
        studyArea={studyArea}
        initialGeometry={studyArea.geometry}
        openedForProject={{ id: PROJECT_ID, name: "Broad Street corridor study" }}
      />
    );

    // The project's boundary, not the workspace county's.
    expect(screen.getByTestId("picker-text")).toHaveTextContent(JSON.stringify(fixtures.drawn));
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Example City, ZZ");
    expect(
      screen.getByText(
        /Prefilled from the study area of Broad Street corridor study \(Example City, ZZ\)/
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Prefilled from this workspace's home geography/)
    ).not.toBeInTheDocument();
  });

  it("still attributes an inherited project area that has no place name", () => {
    // A hand-drawn project area has extent but no identity. There is no name to
    // show, and inventing one would hide that the area was inherited at all.
    const studyArea = inheritedFromProject({
      place_source: "drawn",
      place_kind: null,
      place_ref: null,
      place_label: null,
    });
    render(
      <Harness
        studyArea={studyArea}
        initialGeometry={studyArea.geometry}
        openedForProject={{ id: PROJECT_ID, name: "Broad Street corridor study" }}
      />
    );

    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("this project's study area");
    expect(
      screen.getByText(/Prefilled from the study area of Broad Street corridor study\./)
    ).toBeInTheDocument();
  });

  it("keeps attributing the inherited area after the resolver re-derives it", () => {
    // The resolver runs again when its second candidate arrives — the workspace
    // home geography is fetched after the project's area is already in hand —
    // and re-parsing produces an equal but not identical boundary. An identity
    // comparison dropped the attribution at that moment, leaving an inherited
    // area on screen with nothing saying where it came from.
    const studyArea = inheritedFromHome();
    const rederived = JSON.parse(JSON.stringify(studyArea.geometry)) as CorridorGeometry;
    expect(rederived).not.toBe(studyArea.geometry);

    render(<Harness studyArea={studyArea} initialGeometry={rederived} />);

    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Example County, ZZ");
    expect(
      screen.getByText(/Prefilled from this workspace's home geography \(Example County, ZZ\)/)
    ).toBeInTheDocument();
  });

  it("stops attributing the inherited area once the planner replaces it", () => {
    const studyArea = inheritedFromHome();
    render(<Harness studyArea={studyArea} initialGeometry={studyArea.geometry} />);

    fireEvent.click(screen.getByText("draw-an-area"));

    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("");
    expect(screen.queryByText(/Prefilled from/)).not.toBeInTheDocument();
  });

  it("preselects nothing when the workspace has no home geography", () => {
    render(<Harness studyArea={NOTHING_INHERITED} homeGeographyLoadState="loaded" />);

    expect(screen.getByTestId("picker-text")).toHaveTextContent("");
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("");
    expect(screen.getByText("No study area yet")).toBeInTheDocument();
    expect(screen.getByText(/No home geography is set for this workspace/)).toBeInTheDocument();
  });

  it("does not report an unreachable home geography as none being set", () => {
    render(<Harness studyArea={NOTHING_INHERITED} homeGeographyLoadState="unavailable" />);

    expect(screen.getByText(/could not be checked/)).toBeInTheDocument();
    expect(screen.queryByText(/No home geography is set for this workspace/)).not.toBeInTheDocument();
  });

  it("does not claim nothing is preselected while showing the project's area", () => {
    // Both statements could be true at once — the home lookup failed AND the
    // project supplied an area — but "nothing is preselected" would be a plain
    // falsehood about the boundary on screen.
    const studyArea = inheritedFromProject();
    render(
      <Harness
        studyArea={studyArea}
        initialGeometry={studyArea.geometry}
        homeGeographyLoadState="unavailable"
        openedForProject={{ id: PROJECT_ID, name: "Broad Street corridor study" }}
      />
    );

    expect(screen.queryByText(/could not be checked/)).not.toBeInTheDocument();
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Example City, ZZ");
  });

  it("explains why the project's area is not the one on screen, and links to the record", () => {
    render(
      <Harness
        studyArea={inheritedFromHome()}
        initialGeometry={inheritedFromHome().geometry}
        openedForProject={{ id: PROJECT_ID, name: "Broad Street corridor study" }}
        projectAreaNotice="Broad Street corridor study has no study area of its own yet, so nothing could be inherited from it."
      />
    );

    expect(
      screen.getByText(/Broad Street corridor study has no study area of its own yet/)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open project record" })).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}`
    );
  });

  it("says a study area is a boundary, not an analysis", () => {
    render(<Harness />);

    expect(
      screen.getByText(/This sets the boundary for the run; it does not analyze anything on its own\./)
    ).toBeInTheDocument();
    // The upload is one option among several, not the way in.
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });
});
