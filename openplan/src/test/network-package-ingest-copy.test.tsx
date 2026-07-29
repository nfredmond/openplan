import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REGRESSION GUARD — the models page may not promise that ingest stores the
 * network it was given.
 *
 * THE DEFECT. The empty-state instructions on the network packages panel ended
 * "…to run QA checks and store the bundle". The ingest route stores no bundle:
 * it validates the posted nodes/links GeoJSON, writes `qa_report_json` and a
 * `manifest_json` whose file entries are the fixed strings "nodes.geojson" and
 * "links.geojson", and lets the features go out of scope. A planner who
 * followed those instructions got a passing QA report, zero zones, zero
 * corridors, zero connectors, and no indication that the separate per-component
 * endpoints are what actually populate them — the panel presented a working
 * system as a broken one, which is the same honesty failure as the reverse.
 *
 * The route assertion below is what keeps the copy true over time: if
 * persistence is ever implemented, this test fails and forces the sentence to
 * be rewritten instead of quietly becoming true-by-accident or staying stale.
 */

const INGEST_ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts"
);

const COMPONENT_TABLES = ["network_zones", "network_corridors", "network_connectors"] as const;

const packagesOrderMock = vi.fn();
const createClientMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table !== "network_packages") {
    throw new Error(`Unexpected table: ${table}`);
  }
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: packagesOrderMock,
  };
  return chain;
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { NetworkPackagesPanel } from "@/app/(app)/models/_components/network-packages-panel";

describe("network package ingest instructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ from: fromMock });
    packagesOrderMock.mockResolvedValue({ data: [], error: null });
  });

  it("tells a planner that ingest discards the geometry rather than storing it", async () => {
    const { container } = render(await NetworkPackagesPanel({ workspaceId: "workspace-1" }));
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/store the bundle/i);
    expect(text).toMatch(/does not retain the geometry/i);
  });

  it("points at the endpoints that actually create zones, corridors, and connectors", async () => {
    const { container } = render(await NetworkPackagesPanel({ workspaceId: "workspace-1" }));
    const text = container.textContent ?? "";

    for (const table of COMPONENT_TABLES) {
      const segment = table.replace("network_", "");
      expect(text).toContain(`.../${segment}`);
    }
  });

  it("still matches the route, which writes no network geometry of its own", () => {
    const source = readFileSync(INGEST_ROUTE_PATH, "utf8");

    for (const table of COMPONENT_TABLES) {
      expect(source).not.toContain(table);
    }
    // Supabase Storage is the other way a bundle could be retained; the route
    // does not touch it either.
    expect(source).not.toMatch(/\.storage\b/);
    // The manifest records filenames, not content — the literal strings are the
    // proof that nothing about the posted features survives the request.
    expect(source).toContain('manifest.nodes_file = "nodes.geojson"');
    expect(source).toContain('manifest.links_file = "links.geojson"');
  });
});
