import { describe, expect, it, vi } from "vitest";

import {
  buildBehavioralOnrampKpis,
  loadBehavioralOnrampKpisForWorkspace,
  persistBehavioralOnrampKpis,
} from "@/lib/models/behavioral-onramp-kpis";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

const manifest = {
  schema_version: "openplan.county_onramp_manifest.v1",
  generated_at: "2026-03-24T23:00:00Z",
  name: "nevada-county-runtime",
  county_fips: "06057",
  county_prefix: "NEVADA",
  run_dir: "/tmp/nevada",
  mode: "existing-run",
  stage: "validated-screening",
  artifacts: {
    scaffold_csv: "/tmp/scaffold.csv",
    review_packet_md: "/tmp/review.md",
    run_summary_json: null,
    bundle_manifest_json: null,
    validation_summary_json: null,
  },
  runtime: {
    keep_project: true,
    force: false,
    overall_demand_scalar: 0.369,
    external_demand_scalar: null,
    hbw_scalar: null,
    hbo_scalar: null,
    nhb_scalar: null,
  },
  summary: {
    run: {
      zone_count: 26,
      population_total: 102345,
      jobs_total: 45678,
      loaded_links: 3174,
      final_gap: 0.0091,
      total_trips: 231828.75,
    },
    validation: null,
    bundle_validation: null,
  },
} as unknown as CountyOnrampManifest;

describe("buildBehavioralOnrampKpis", () => {
  it("derives six behavioral KPIs from a county onramp manifest", () => {
    const kpis = buildBehavioralOnrampKpis(manifest);
    expect(kpis).toHaveLength(6);
    expect(kpis.every((kpi) => kpi.kpi_category === "behavioral_onramp")).toBe(true);
    const totalTrips = kpis.find((kpi) => kpi.kpi_name === "total_trips");
    expect(totalTrips?.value).toBe(231828.75);
    expect(totalTrips?.unit).toBe("trips");
    expect(totalTrips?.breakdown_json).toEqual({
      source: "county_onramp",
      stage: "validated-screening",
      mode: "existing-run",
      generated_at: "2026-03-24T23:00:00Z",
    });
  });
});

describe("persistBehavioralOnrampKpis", () => {
  it("clears existing behavioral rows then inserts fresh KPIs for the county run", async () => {
    const captured: {
      deleteEqFirst?: [string, string];
      deleteEqSecond?: [string, string];
      insert?: unknown;
    } = {};

    const from = vi.fn((table: string) => {
      if (table !== "model_run_kpis") throw new Error(`Unexpected table: ${table}`);
      return {
        delete: vi.fn(() => ({
          eq: vi.fn((col1: string, val1: string) => {
            captured.deleteEqFirst = [col1, val1];
            return {
              eq: vi.fn(async (col2: string, val2: string) => {
                captured.deleteEqSecond = [col2, val2];
                return { error: null };
              }),
            };
          }),
        })),
        insert: vi.fn(async (rows: unknown) => {
          captured.insert = rows;
          return { error: null };
        }),
      };
    });

    const result = await persistBehavioralOnrampKpis({
      supabase: { from } as unknown as Parameters<typeof persistBehavioralOnrampKpis>[0]["supabase"],
      countyRunId: "run-1",
      manifest,
    });

    expect(result.error).toBeNull();
    expect(captured.deleteEqFirst).toEqual(["county_run_id", "run-1"]);
    expect(captured.deleteEqSecond).toEqual(["kpi_category", "behavioral_onramp"]);
    const rows = captured.insert as Array<{ kpi_name: string; county_run_id: string; run_id: null }>;
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.county_run_id === "run-1")).toBe(true);
    expect(rows.every((row) => row.run_id === null)).toBe(true);
  });

  it("surfaces a delete error without attempting an insert", async () => {
    const insertMock = vi.fn();
    const from = vi.fn((table: string) => {
      if (table !== "model_run_kpis") throw new Error(`Unexpected table: ${table}`);
      return {
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: { message: "delete failed", code: "42501" } })),
          })),
        })),
        insert: insertMock,
      };
    });

    const result = await persistBehavioralOnrampKpis({
      supabase: { from } as unknown as Parameters<typeof persistBehavioralOnrampKpis>[0]["supabase"],
      countyRunId: "run-1",
      manifest,
    });

    expect(result.error).toEqual({ message: "delete failed", code: "42501" });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("loadBehavioralOnrampKpisForWorkspace", () => {
  function buildFromMock(countyRunRows: Array<{ id: string; stage: string }>, kpiRows: unknown[]) {
    const kpiIn = vi.fn(async () => ({ data: kpiRows, error: null }));
    return vi.fn((table: string) => {
      if (table === "county_runs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: countyRunRows, error: null })),
          })),
        };
      }
      if (table === "model_run_kpis") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: kpiIn })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
  }

  it("holds screening-grade runs back when caller does not accept caveats", async () => {
    const from = buildFromMock(
      [
        { id: "run-1", stage: "validated-screening" },
        { id: "run-2", stage: "runtime-complete" },
      ],
      []
    );

    const result = await loadBehavioralOnrampKpisForWorkspace({
      supabase: { from } as unknown as Parameters<typeof loadBehavioralOnrampKpisForWorkspace>[0]["supabase"],
      workspaceId: "ws-1",
    });

    expect(result.error).toBeNull();
    expect(result.kpis).toEqual([]);
    expect(result.rejectedCountyRunIds).toEqual(["run-1", "run-2"]);
    expect(result.caveatGateReason).toBe("screening_grade_refused");
  });

  it("returns KPIs when caller passes acceptScreeningGrade: true", async () => {
    const from = buildFromMock(
      [{ id: "run-1", stage: "validated-screening" }],
      [
        {
          kpi_name: "total_trips",
          kpi_label: "Total trips (behavioral)",
          value: 100,
          unit: "trips",
          breakdown_json: {},
          county_run_id: "run-1",
          run_id: null,
        },
      ]
    );

    const result = await loadBehavioralOnrampKpisForWorkspace({
      supabase: { from } as unknown as Parameters<typeof loadBehavioralOnrampKpisForWorkspace>[0]["supabase"],
      workspaceId: "ws-1",
      consent: { acceptScreeningGrade: true },
    });

    expect(result.error).toBeNull();
    expect(result.kpis).toHaveLength(1);
    expect(result.kpis[0]?.kpi_name).toBe("total_trips");
    expect(result.rejectedCountyRunIds).toEqual([]);
    expect(result.caveatGateReason).toBeNull();
  });

  it("short-circuits when the workspace has no county runs", async () => {
    const selectEq = vi.fn(async () => ({ data: [], error: null }));
    const kpiSelectMock = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === "county_runs") {
        return {
          select: vi.fn(() => ({ eq: selectEq })),
        };
      }
      if (table === "model_run_kpis") {
        return { select: kpiSelectMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await loadBehavioralOnrampKpisForWorkspace({
      supabase: { from } as unknown as Parameters<typeof loadBehavioralOnrampKpisForWorkspace>[0]["supabase"],
      workspaceId: "ws-1",
    });

    expect(result.error).toBeNull();
    expect(result.kpis).toEqual([]);
    expect(kpiSelectMock).not.toHaveBeenCalled();
  });
});
