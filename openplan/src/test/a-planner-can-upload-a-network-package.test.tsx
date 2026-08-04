import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PATH TO THE UNIT, NOT THE UNIT.
 *
 * Six network-package routes — create a package, add a version, QA the nodes
 * and links, create zones, corridors and connectors — were complete, role-gated
 * and audited, and sat in the `KNOWN_UNWIRED` ratchet in
 * `every-api-route-has-a-caller.test.ts` because nothing in the product called
 * any of them. The panel said so out loud: "Ingest is API-only for now."
 *
 * WHAT THIS TEST INSISTS ON, and why each assertion is here rather than a
 * cheaper one:
 *
 *   1. The form is reached THROUGH THE REAL PANEL. `NetworkPackagesPanel` is
 *      rendered and awaited, and the package the form offers comes out of the
 *      panel's own Supabase read. A test that rendered the form directly with a
 *      hand-written package list would prove the form works and prove nothing
 *      about whether a planner can get to it — the exact mistake that shipped a
 *      stage-gate action whose offer no board could ever satisfy.
 *
 *   2. The `.select()` PROJECTION is asserted. The Supabase mock answers with
 *      whatever fixture it holds no matter which columns were asked for, so
 *      dropping `name` from the panel's projection would leave every rendering
 *      assertion green while the real page offered a package with no name.
 *
 *   3. The six URLs are asserted from a REAL SUBMIT of the real form with real
 *      File objects, in order, including that the connector's `zone_id` is the
 *      uuid the zones POST returned. That FK is the one thing a planner's file
 *      cannot contain, so it is the one thing worth proving end to end.
 *
 *   4. A failing QA report stops the upload. Attaching zones to a network the
 *      QA report says is broken would create real rows against a basis nobody
 *      should model with.
 *
 *   5. The `<select>` vocabularies match the CHECK constraints in the
 *      migration, so the two copies cannot drift in silence.
 */

const COMPONENT_MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260318000028_network_zones_corridors_connectors.sql"
);

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { NetworkPackagesPanel } from "@/app/(app)/models/_components/network-packages-panel";
import {
  CONNECTOR_TYPES,
  CORRIDOR_DIRECTIONS,
  CORRIDOR_TYPES,
  ZONE_TYPES,
} from "@/app/(app)/models/_components/network-package-upload-plan";
import { BODY_LIMITS } from "@/lib/http/body-limit";

type SelectCall = { table: string; columns: string };

const selectCalls: SelectCall[] = [];

const PACKAGE_ROWS = [
  {
    id: "pkg-existing",
    name: "Regional network 2024",
    description: null,
    region_code: null,
    bbox: null,
    updated_at: "2026-07-01T00:00:00.000Z",
  },
];

/**
 * Stands in for PostgREST, answering the exact chains the panel builds. It
 * records every projection so the test can assert on the columns asked for
 * rather than on the fixture it would return regardless.
 */
function supabaseStub({ packages }: { packages: typeof PACKAGE_ROWS }) {
  return {
    from(table: string) {
      const state = { head: false };
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select(columns: string, options?: { head?: boolean }) {
          selectCalls.push({ table, columns });
          state.head = Boolean(options?.head);
          return chain;
        },
        eq() {
          return state.head ? Promise.resolve({ count: 0, error: null }) : chain;
        },
        in() {
          return chain;
        },
        order() {
          if (table === "network_packages") {
            return Promise.resolve({ data: packages, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      });
      return chain;
    },
  };
}

function featureCollection(features: unknown[]) {
  return JSON.stringify({ type: "FeatureCollection", features });
}

function geojsonFile(name: string, features: unknown[]) {
  return new File([featureCollection(features)], name, { type: "application/geo+json" });
}

const NODES = [
  { type: "Feature", geometry: { type: "Point", coordinates: [-120.5, 39.2] }, properties: { id: "N-1" } },
  { type: "Feature", geometry: { type: "Point", coordinates: [-120.1, 39.6] }, properties: { id: "N-2" } },
];

const LINKS = [
  {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[-120.5, 39.2], [-120.1, 39.6]] },
    properties: { id: "L-1", speed: 45, capacity: 1800 },
  },
];

const ZONES = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-120.5, 39.2], [-120.1, 39.2], [-120.1, 39.6], [-120.5, 39.2]]] },
    properties: { zone_id: "TAZ-7", name: "Downtown", zone_type: "taz" },
  },
];

const CORRIDORS = [
  {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[-120.5, 39.2], [-120.1, 39.6]] },
    properties: { corridor_name: "Main Street", corridor_type: "arterial", direction: "both" },
  },
];

const CONNECTORS = [
  {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[-120.4, 39.3], [-120.5, 39.2]] },
    properties: { zone_id: "TAZ-7", target_node_id: "N-1", connector_type: "walk", impedance_minutes: 3 },
  },
];

type FetchCall = { url: string; body: Record<string, unknown> };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Answers each of the six routes the way the real ones do. */
function installFetch(
  calls: FetchCall[],
  overrides: { ingestStatus?: string; dropQaSummary?: boolean } = {}
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });

    if (url === "/api/network-packages") return jsonResponse({ data: { id: "pkg-new" } });
    if (url.endsWith("/versions")) return jsonResponse({ data: { id: "ver-1" } });
    if (url.endsWith("/ingest")) {
      const status = overrides.ingestStatus ?? "pass";
      return jsonResponse({
        status,
        qa_report: overrides.dropQaSummary
          ? {}
          : { summary: { total_checks: 5, passed: 5, warnings: 0, failures: status === "fail" ? 2 : 0 } },
        message: status === "fail" ? "Ingestion failed QA checks." : "Ingestion passed all QA checks.",
      });
    }
    if (url.endsWith("/zones")) return jsonResponse({ id: "zone-row-1", zone_id_external: "TAZ-7" }, 201);
    if (url.endsWith("/corridors")) return jsonResponse({ id: "corridor-row-1" }, 201);
    if (url.endsWith("/connectors")) return jsonResponse({ id: "connector-row-1" }, 201);
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderPanel(packages = PACKAGE_ROWS) {
  createClientMock.mockResolvedValue(supabaseStub({ packages }));
  return render(await NetworkPackagesPanel({ workspaceId: "workspace-1" }));
}

function inputByLabel(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`No input labelled "${label}"`);
  return input;
}

function attach(label: string, file: File) {
  fireEvent.change(inputByLabel(label), { target: { files: [file] } });
}

function type(label: string, value: string) {
  fireEvent.change(inputByLabel(label), { target: { value } });
}

/** Open the form, fill it, and submit — everything a planner does. */
async function fillAndSubmit(options: { withComponents: boolean }) {
  fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));

  type("Version name", "2026 base year");
  type("Package name", "Countywide network");
  type("Region code", "AGENCY-01");
  type("Coordinate reference system", "EPSG:4326");

  attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
  attach("Links GeoJSON", geojsonFile("links.geojson", LINKS));
  if (options.withComponents) {
    attach("Zones GeoJSON", geojsonFile("zones.geojson", ZONES));
    attach("Corridors GeoJSON", geojsonFile("corridors.geojson", CORRIDORS));
    attach("Connectors GeoJSON", geojsonFile("connectors.geojson", CONNECTORS));
  }

  fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));
}

describe("a planner can upload a network package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCalls.length = 0;
  });

  it("offers the upload form from the models panel a planner already lands on", async () => {
    installFetch([]);
    await renderPanel();

    // The panel is the only surface that renders this panel's contents, so
    // finding the control here is finding the path a planner walks.
    expect(screen.getByRole("button", { name: /upload a network package/i })).toBeInTheDocument();
  });

  it("no longer tells a planner the only way in is the API", async () => {
    installFetch([]);
    const { container } = await renderPanel([]);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/API-only/i);
    expect(text).not.toMatch(/no in-app upload form/i);
    // The one thing about ingest that did NOT change.
    expect(text).toMatch(/does not retain the geometry/i);
  });

  it("asks the database for the columns the upload form needs", async () => {
    installFetch([]);
    await renderPanel();

    const packageSelect = selectCalls.find((call) => call.table === "network_packages");
    expect(packageSelect, "the panel must read network_packages").toBeTruthy();
    // The form offers existing packages by id and name. A projection that drops
    // either would render an unnamed or unselectable option, and the fixture
    // would hide it.
    expect(packageSelect!.columns).toContain("id");
    expect(packageSelect!.columns).toContain("name");
  });

  it("populates the package chooser from the panel's own read, not from a fixture", async () => {
    installFetch([]);
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));

    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Package"]');
    expect(select).toBeTruthy();
    const options = Array.from(select!.options).map((option) => option.textContent);
    expect(options).toContain("Create a new package");
    expect(options).toContain(PACKAGE_ROWS[0].name);
  });

  it("drives all six network-package routes, in order, from one submit", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    await fillAndSubmit({ withComponents: true });

    await waitFor(() => expect(calls.length).toBe(6));

    expect(calls.map((call) => call.url)).toEqual([
      "/api/network-packages",
      "/api/network-packages/pkg-new/versions",
      "/api/network-packages/pkg-new/versions/ver-1/ingest",
      "/api/network-packages/pkg-new/versions/ver-1/zones",
      "/api/network-packages/pkg-new/versions/ver-1/corridors",
      "/api/network-packages/pkg-new/versions/ver-1/connectors",
    ]);

    // The package carries the workspace it belongs to and a bounding box read
    // off the network itself rather than four numbers a planner had to find.
    expect(calls[0].body).toMatchObject({
      workspace_id: "workspace-1",
      name: "Countywide network",
      region_code: "AGENCY-01",
      bbox: [-120.5, 39.2, -120.1, 39.6],
    });

    expect(calls[1].body).toMatchObject({ version_name: "2026 base year", status: "draft" });

    // Ingest gets the files as they were written, plus the declared CRS.
    expect(calls[2].body).toMatchObject({ crs: "EPSG:4326" });
    expect((calls[2].body.nodes as { features: unknown[] }).features).toHaveLength(2);
    expect((calls[2].body.links as { features: unknown[] }).features).toHaveLength(1);

    expect(calls[3].body).toMatchObject({
      zone_id_external: "TAZ-7",
      zone_type: "taz",
      name: "Downtown",
    });

    expect(calls[4].body).toMatchObject({
      corridor_name: "Main Street",
      corridor_type: "arterial",
      direction: "both",
    });

    // THE ASSERTION THIS TEST EXISTS FOR. `network_connectors.zone_id` is a NOT
    // NULL uuid FK the database assigned moments ago; a planner's file can only
    // name "TAZ-7". If the form sent the external id, every connector upload
    // would 500 against a real database and no unit test of the route would
    // notice.
    expect(calls[5].body).toMatchObject({
      zone_id: "zone-row-1",
      target_node_id: "N-1",
      connector_type: "walk",
      impedance_minutes: 3,
    });
    expect(calls[5].body).not.toHaveProperty("zoneExternalId");

    // The panel's counts were read before any of this ran. Saying so, and
    // offering the reload, is the difference between a stale number and a lie.
    const success = await screen.findByText(/Upload complete/i);
    expect(success.textContent).toMatch(/still show the workspace as it was/i);
    expect(screen.getByRole("button", { name: /reload the counts/i })).toBeInTheDocument();
  });

  it("creates no zones, corridors or connectors when the network fails QA", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls, { ingestStatus: "fail" });
    await renderPanel();

    await fillAndSubmit({ withComponents: true });

    await waitFor(() => expect(calls.length).toBe(3));
    expect(calls.map((call) => call.url)).toEqual([
      "/api/network-packages",
      "/api/network-packages/pkg-new/versions",
      "/api/network-packages/pkg-new/versions/ver-1/ingest",
    ]);

    // And it says which of the two different facts is true: the version exists
    // and is a draft, the components were not attempted.
    const alert = await screen.findByText(/did not pass QA/i);
    expect(alert.textContent).toMatch(/left as a draft/i);
    expect(alert.textContent).toMatch(/no zones, corridors or connectors were created/i);
    expect(screen.queryByText(/Upload complete/i)).not.toBeInTheDocument();
  });

  it("refuses a connectors file with no zones file instead of writing half an upload", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));
    type("Version name", "2026 base year");
    type("Package name", "Countywide network");
    attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
    attach("Links GeoJSON", geojsonFile("links.geojson", LINKS));
    attach("Connectors GeoJSON", geojsonFile("connectors.geojson", CONNECTORS));
    fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));

    expect(await screen.findByText(/a zones file is required alongside it/i)).toBeInTheDocument();
    // Nothing was created, so nothing has to be cleaned up.
    expect(calls).toEqual([]);
  });

  /**
   * ADDED ON REVIEW. The six routes were wired and the six mutations above all
   * reproduce, but four things the form could do to a planner were not covered
   * by anything, and each one writes to their workspace or tells them something
   * untrue before they can notice.
   */

  it("refuses an oversized network before creating a package or a version", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    // Every route reads its body through `readJsonWithLimit` and answers 413
    // above this ceiling. Ingest is the THIRD request, so without a pre-flight
    // weigh-in a planner with a real-sized network gets a package and an empty
    // version created and THEN the refusal.
    const fatLinks = Array.from({ length: 400 }, (_, index) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-120.5, 39.2], [-120.1, 39.6]] },
      properties: { id: `L-${index}`, speed: 45, capacity: 1800, note: "x".repeat(6000) },
    }));
    expect(featureCollection(fatLinks).length).toBeGreaterThan(BODY_LIMITS.networkGeoJson);

    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));
    type("Version name", "2026 base year");
    type("Package name", "Countywide network");
    attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
    attach("Links GeoJSON", geojsonFile("links.geojson", fatLinks));
    fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));

    const problem = await screen.findByText(/accepts at most/i);
    // It names the measured size and the ceiling, and does not offer the one
    // remedy this form cannot carry out — splitting one network across the
    // versions it creates one at a time.
    expect(problem.textContent).toMatch(/would be \d+\.\d MB/);
    expect(problem.textContent).toMatch(/2\.0 MB per request/);
    expect(problem.textContent).not.toMatch(/split/i);
    expect(calls).toEqual([]);
  });

  it("does not report an attached but empty file as no file at all", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));
    type("Version name", "2026 base year");
    type("Package name", "Countywide network");
    attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
    attach("Links GeoJSON", geojsonFile("links.geojson", LINKS));
    attach("Zones GeoJSON", new File([""], "zones.geojson", { type: "application/geo+json" }));
    fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));

    // "No zones file." is a claim about the world, and the planner is looking
    // at the zones file they attached. What is true is that it is empty.
    const problem = await screen.findByText(/zones\.geojson is not valid JSON/i);
    expect(problem).toBeInTheDocument();
    expect(screen.queryByText(/No zones file/i)).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("refuses duplicate zone ids when connectors would resolve against them", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    const duplicated = [
      ZONES[0],
      { ...ZONES[0], properties: { ...ZONES[0].properties, name: "Riverside" } },
    ];

    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));
    type("Version name", "2026 base year");
    type("Package name", "Countywide network");
    attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
    attach("Links GeoJSON", geojsonFile("links.geojson", LINKS));
    attach("Zones GeoJSON", geojsonFile("zones.geojson", duplicated));
    attach("Connectors GeoJSON", geojsonFile("connectors.geojson", CONNECTORS));
    fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));

    // The database permits the duplicate and the step ledger would count both
    // zones as created, so every connector for "TAZ-7" would attach to whichever
    // row came last with nothing anywhere saying so.
    const problem = await screen.findByText(/used by more than one feature/i);
    expect(problem.textContent).toMatch(/"TAZ-7"/);
    expect(calls).toEqual([]);
  });

  it("uploads duplicate zone ids when no connectors resolve against them", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls);
    await renderPanel();

    const duplicated = [
      ZONES[0],
      { ...ZONES[0], properties: { ...ZONES[0].properties, name: "Riverside" } },
    ];

    fireEvent.click(screen.getByRole("button", { name: /upload a network package/i }));
    type("Version name", "2026 base year");
    type("Package name", "Countywide network");
    attach("Nodes GeoJSON", geojsonFile("nodes.geojson", NODES));
    attach("Links GeoJSON", geojsonFile("links.geojson", LINKS));
    attach("Zones GeoJSON", geojsonFile("zones.geojson", duplicated));
    fireEvent.click(screen.getByRole("button", { name: /^upload network package$/i }));

    // Over-restriction is its own defect. With no connectors file nothing
    // resolves by zone id, so this is the planner's own data and it is theirs
    // to load.
    await waitFor(() => expect(calls.length).toBe(5));
    expect(calls.filter((call) => call.url.endsWith("/zones"))).toHaveLength(2);
  });

  it("stops rather than treating an unreadable QA verdict as a pass", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls, { ingestStatus: "not-a-verdict" });
    await renderPanel();

    await fillAndSubmit({ withComponents: true });

    // "Could not be read" and "passed" are different facts, and only one of
    // them may attach real rows to a modeling basis.
    const alert = await screen.findByText(/verdict could not be read/i);
    expect(alert.textContent).toMatch(/no zones, corridors or connectors were sent/i);
    await waitFor(() => expect(calls.length).toBe(3));
    expect(screen.queryByText(/Upload complete/i)).not.toBeInTheDocument();
  });

  it("shows no QA counts when the response carried none", async () => {
    const calls: FetchCall[] = [];
    installFetch(calls, { ingestStatus: "pass", dropQaSummary: true });
    await renderPanel();

    await fillAndSubmit({ withComponents: false });

    // An invented "0 passed, 0 warnings, 0 failures" reads exactly like a real
    // QA result, and a planner has no way to tell the two apart.
    // It says so in the step ledger and in the summary line, which is why this
    // asks for all matches rather than one.
    expect((await screen.findAllByText(/carried no check counts/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 passed, 0 warnings, 0 failures/)).not.toBeInTheDocument();
  });

  it("keeps its dropdown vocabularies identical to the database CHECK constraints", () => {
    const sql = readFileSync(COMPONENT_MIGRATION, "utf8");

    const vocabulary = (column: string): string[] => {
      const match = sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`, "i"));
      if (!match) throw new Error(`No CHECK constraint found for ${column}`);
      return match[1]
        .split(",")
        .map((value) => value.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
    };

    expect([...ZONE_TYPES]).toEqual(vocabulary("zone_type"));
    expect([...CORRIDOR_TYPES]).toEqual(vocabulary("corridor_type"));
    expect([...CORRIDOR_DIRECTIONS]).toEqual(vocabulary("direction"));
    expect([...CONNECTOR_TYPES]).toEqual(vocabulary("connector_type"));
  });
});
