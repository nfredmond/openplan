import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMapPresence } from "@/components/projects/project-map-presence";
import { CORRIDOR_MAX_VERTICES } from "@/lib/cartographic/corridor-vocabulary";

/**
 * THE OTHER TWO FILES THE PLANNER ALREADY HAD.
 *
 * A tester arrived at a project with the corridor and the project's spot both
 * sitting in a handover folder, watched Data Hub read them, and then had to
 * redraw both by hand: the project's study-area control learned to take a file
 * in df5d1574, and these two — "Study corridors" and "Map location" — were the
 * last draw-only geography controls on the project.
 *
 * EVERY TEST HERE DRIVES THE REAL FILE CHOOSER WITH A REAL FILE and asserts on
 * the request body the save produces. A test that called the upload callback
 * would pass with nothing mounted at all, which is the exact defect this repo
 * has recorded eleven times: complete, tested capability no person can reach.
 *
 * Two claims are load-bearing beyond "it works":
 *   - A POINT IS NOT A POLYGON. Several points is a refusal, never a silent
 *     first-coordinate. One area is a computed spot, and the screen says it was
 *     computed, before anything is saved.
 *   - A FILE CONFERS NO PLACE IDENTITY. What a file produces is the SAME
 *     request a drawn shape produces, field for field. If a later lane adds a
 *     provenance field claiming the file resolved a place, the corridor test
 *     below fails on its key list.
 */

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));

// The picker owns a Mapbox surface and has its own tests. Here it only has to
// exist; nothing in this file draws anything.
vi.mock("@/components/engagement/geometry-picker-map", () => ({
  GeometryPickerMap: () => <div data-testid="geometry-picker" />,
}));

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function panel() {
  return (
    <ProjectMapPresence
      projectId={PROJECT_ID}
      initialLatitude={null}
      initialLongitude={null}
      initialCorridors={[]}
      canWrite
    />
  );
}

/** A real file, with the one method jsdom does not implement supplied. */
function geoJsonFile(name: string, value: unknown): File {
  const text = JSON.stringify(value);
  const file = new File([text], name, { type: "application/geo+json" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  return file;
}

function featureCollection(...geometries: unknown[]) {
  return {
    type: "FeatureCollection",
    features: geometries.map((geometry) => ({ type: "Feature", properties: {}, geometry })),
  };
}

function line(...coordinates: [number, number][]) {
  return { type: "LineString", coordinates };
}

function chooseFile(labelPattern: RegExp, file: File) {
  const input = screen.getByLabelText(labelPattern) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}

describe("project geography, from a file", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            corridor: { id: "c1", name: "Main Street", corridorType: "arterial", losGrade: null },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("saves a corridor read from a file, with the same request a drawn one sends", async () => {
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: /add a corridor/i }));

    chooseFile(
      /for the corridor/i,
      geoJsonFile("main-street.geojson", featureCollection(line([-121.06, 39.22], [-121.04, 39.24])))
    );

    await waitFor(() => expect(screen.getByText(/main-street\.geojson/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Main Street" } });
    fireEvent.click(screen.getByRole("button", { name: /save corridor/i }));

    await waitFor(() => expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`).length).toBe(1));
    const body = bodyOf(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`)[0]);

    expect(body.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-121.06, 39.22],
        [-121.04, 39.24],
      ],
    });
    // Field for field, this is what drawing sends. A file gives a shape and
    // nothing else — no place, no county, no claim that it resolved anything.
    expect(Object.keys(body).sort()).toEqual(["corridorType", "geometry", "losGrade", "name"]);
  });

  it("joins corridor pieces only where their ends meet, and says that it did", async () => {
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: /add a corridor/i }));

    // Two rows out of a GIS: the second is digitised backwards, which is why
    // concatenating in file order would draw a zig-zag through the town.
    chooseFile(
      /for the corridor/i,
      geoJsonFile(
        "segments.geojson",
        featureCollection(
          line([-121.0, 39.0], [-121.1, 39.05]),
          line([-121.2, 39.1], [-121.1, 39.05])
        )
      )
    );

    await waitFor(() => expect(screen.getByText(/joined end to end/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Ridge Road" } });
    fireEvent.click(screen.getByRole("button", { name: /save corridor/i }));

    await waitFor(() => expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`).length).toBe(1));
    const body = bodyOf(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`)[0]);
    expect(body.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-121.0, 39.0],
        [-121.1, 39.05],
        [-121.2, 39.1],
      ],
    });
  });

  it("refuses corridor pieces that do not join, rather than inventing the link", async () => {
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: /add a corridor/i }));

    chooseFile(
      /for the corridor/i,
      geoJsonFile(
        "two-corridors.geojson",
        featureCollection(
          line([-121.0, 39.0], [-121.1, 39.05]),
          line([-120.5, 38.6], [-120.4, 38.65])
        )
      )
    );

    await waitFor(() => expect(screen.getByText(/ends do not meet/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Ridge Road" } });
    fireEvent.click(screen.getByRole("button", { name: /save corridor/i }));

    await waitFor(() =>
      expect(screen.getByText(/a corridor needs at least two points/i)).toBeTruthy()
    );
    expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`).length).toBe(0);
  });

  it("says a corridor line is too detailed here, instead of letting the save fail", async () => {
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: /add a corridor/i }));

    // A street centreline straight out of a GIS easily runs past the cap these
    // display corridors store. Without this check the planner would draw a
    // fine-looking line and then be handed the server's rejection.
    const dense = Array.from(
      { length: 260 },
      (_, index) => [-121 + index / 10000, 39 + index / 10000] as [number, number]
    );
    chooseFile(/for the corridor/i, geoJsonFile("centreline.geojson", featureCollection(line(...dense))));

    // The number and the limit, in the refusal itself — not the vertex counter,
    // which says "260 points" whether or not the line was refused.
    await waitFor(() =>
      expect(
        screen.getByText(
          new RegExp(`260 points, and a corridor here can hold ${CORRIDOR_MAX_VERTICES}`, "i")
        )
      ).toBeTruthy()
    );
    expect(screen.getByText(/simplify the line/i)).toBeTruthy();
    expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`).length).toBe(0);
  });

  it("tells a planner who uploaded an area to a corridor what a corridor is", async () => {
    render(panel());
    fireEvent.click(screen.getByRole("button", { name: /add a corridor/i }));

    chooseFile(
      /for the corridor/i,
      geoJsonFile(
        "study-area.geojson",
        featureCollection({
          type: "Polygon",
          coordinates: [
            [
              [-121.1, 39.2],
              [-121.0, 39.2],
              [-121.0, 39.3],
              [-121.1, 39.2],
            ],
          ],
        })
      )
    );

    await waitFor(() => expect(screen.getByText(/holds areas, not lines/i)).toBeTruthy());
    expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/corridors`).length).toBe(0);
  });

  it("takes the project's spot from a file holding one point", async () => {
    render(panel());

    chooseFile(
      /for the project location/i,
      geoJsonFile(
        "site.geojson",
        featureCollection({ type: "Point", coordinates: [-121.0611, 39.2191] })
      )
    );

    await waitFor(() => expect(screen.getByText(/site\.geojson/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));

    await waitFor(() => expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`).length).toBe(1));
    expect(bodyOf(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`)[0])).toEqual({
      latitude: 39.2191,
      longitude: -121.0611,
    });
  });

  it("works out a spot from a single area, says so, and saves nothing until asked", async () => {
    render(panel());

    chooseFile(
      /for the project location/i,
      geoJsonFile(
        "study-area.geojson",
        featureCollection({
          type: "Polygon",
          coordinates: [
            [
              [-121.1, 39.2],
              [-121.0, 39.2],
              [-121.0, 39.3],
              [-121.1, 39.3],
              [-121.1, 39.2],
            ],
          ],
        })
      )
    );

    // The sentence is the point: a spot OpenPlan worked out is never presented
    // as a spot the file stated.
    await waitFor(() => expect(screen.getByText(/middle of the box/i)).toBeTruthy());
    // Reading a file saves nothing. The planner reads the two numbers first.
    expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`).length).toBe(0);
    expect((screen.getByLabelText(/^latitude$/i) as HTMLInputElement).value).toBe("39.25");
    expect((screen.getByLabelText(/^longitude$/i) as HTMLInputElement).value).toBe("-121.05");

    fireEvent.click(screen.getByRole("button", { name: /save location/i }));
    await waitFor(() => expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`).length).toBe(1));
    expect(bodyOf(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`)[0])).toEqual({
      latitude: 39.25,
      longitude: -121.05,
    });
  });

  it("refuses to choose among several points instead of taking the first one", async () => {
    render(panel());

    chooseFile(
      /for the project location/i,
      geoJsonFile(
        "sites.geojson",
        featureCollection(
          { type: "Point", coordinates: [-121.0611, 39.2191] },
          { type: "Point", coordinates: [-120.9, 39.4] }
        )
      )
    );

    await waitFor(() => expect(screen.getByText(/will not choose one of them/i)).toBeTruthy());
    expect((screen.getByLabelText(/^latitude$/i) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /save location/i }));

    await waitFor(() =>
      expect(screen.getByText(/enter both a latitude and a longitude/i)).toBeTruthy()
    );
    expect(callsTo(fetchMock, `/projects/${PROJECT_ID}/location`).length).toBe(0);
  });
});
