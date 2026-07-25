import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  loadDesignationsFromDb,
  createDbDesignationAdapter,
  upsertDesignations,
  EQUITY_DESIGNATION_DB_SOURCE_IDS,
  type DbDesignationDescriptor,
} from "@/lib/data-sources/equity-designation/db";
import { resolveJustice40ForTracts } from "@/lib/data-sources/equity-designation/registry";
import { DesignationSourceUnavailableError } from "@/lib/data-sources/equity-designation/types";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260724000001_equity_tract_designations.sql"),
  "utf8"
);

// Minimal Supabase-client stub: a chainable .from().select().eq().eq().in().
function selectClient(rows: Array<{ geoid: string; is_disadvantaged: boolean }>, error: unknown = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ data: rows, error }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

const CA_DESCRIPTOR: DbDesignationDescriptor = {
  id: "calenviroscreen-ca",
  label: "CalEnviroScreen / SB 535 (California)",
  attribution: "California OEHHA / CalEPA",
  license: "Public domain",
  version: "4.0",
  vintage: "2010",
  datasetLabel: "CalEnviroScreen 4.0",
  coverageState: "cejst_national",
  persistable: true,
  covers: (bbox) => bbox.minLon <= -114 && bbox.maxLon >= -124.6 && bbox.minLat <= 42.1 && bbox.maxLat >= 32.4,
};

describe("equity_tract_designations migration", () => {
  it("is a public reference table with a service-role-only batch upsert", () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS equity_tract_designations/);
    expect(migrationSql).toMatch(/PRIMARY KEY \(geoid, source_id, version\)/);
    expect(migrationSql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migrationSql).toMatch(/FOR SELECT\s+TO anon, authenticated\s+USING \(true\)/);
    expect(migrationSql).toMatch(/SET search_path = public, pg_catalog/);
    expect(migrationSql).toMatch(/REVOKE EXECUTE ON FUNCTION upsert_equity_designations[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migrationSql).toMatch(/GRANT EXECUTE ON FUNCTION upsert_equity_designations[\s\S]*TO service_role/);
  });

  it("keeps the source_id CHECK domain in lockstep with EQUITY_DESIGNATION_DB_SOURCE_IDS", () => {
    const match = /source_id\s+TEXT NOT NULL CHECK \(source_id IN \(([^)]*)\)\)/.exec(migrationSql);
    expect(match, "source_id CHECK missing").toBeTruthy();
    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(allowed.sort()).toEqual([...EQUITY_DESIGNATION_DB_SOURCE_IDS].sort());
  });
});

describe("loadDesignationsFromDb", () => {
  it("builds a lookup where absent geoids are undetermined, not false", async () => {
    const client = selectClient([
      { geoid: "06001400100", is_disadvantaged: true },
      { geoid: "06001400200", is_disadvantaged: false },
    ]);
    const result = await loadDesignationsFromDb(client, {
      sourceId: "calenviroscreen-ca",
      version: "4.0",
      geoids: ["06001400100", "06001400200", "06001409999"],
    });
    expect(result.determinedTotal).toBe(2);
    expect(result.disadvantagedTotal).toBe(1);
    expect(result.byGeoid.get("06001400100")).toBe(true);
    expect(result.byGeoid.has("06001409999")).toBe(false); // undetermined, not false
  });

  it("throws (never returns empty-as-negative) on a query error", async () => {
    const client = selectClient([], { message: "boom" });
    await expect(
      loadDesignationsFromDb(client, { sourceId: "calenviroscreen-ca", version: "4.0", geoids: ["06001400100"] })
    ).rejects.toBeInstanceOf(DesignationSourceUnavailableError);
  });
});

describe("resolveJustice40ForTracts with an injected DB adapter", () => {
  it("lets a DB-backed regional source outrank the bundled national CEJST", async () => {
    const client = selectClient([{ geoid: "06001400100", is_disadvantaged: true }]);
    const adapter = createDbDesignationAdapter(CA_DESCRIPTOR, client);
    const CA_BBOX = { minLon: -122, minLat: 37, maxLon: -121.9, maxLat: 37.1 };

    const det = await resolveJustice40ForTracts(CA_BBOX, ["06001400100"], [adapter]);

    expect(det.source).toBe("calenviroscreen-ca");
    expect(det.status).toBe("disadvantaged");
    expect(det.coverage.disadvantagedTracts).toBe(1);
  });
});

describe("upsertDesignations", () => {
  it("calls the service-role RPC with snake_cased batch rows and sums affected counts", async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = { rpc } as any;

    const result = await upsertDesignations(service, {
      sourceId: "cejst-national",
      version: "1.0",
      attribution: "CEQ/USDS",
      retrievedAt: "2026-07-24T00:00:00.000Z",
      rows: [
        { geoid: "01003010100", isDisadvantaged: true },
        { geoid: "01001020100", isDisadvantaged: false },
      ],
    });

    expect(result.error).toBeNull();
    expect(result.affected).toBe(2);
    expect(rpc).toHaveBeenCalledWith("upsert_equity_designations", {
      p_source_id: "cejst-national",
      p_version: "1.0",
      p_attribution: "CEQ/USDS",
      p_retrieved_at: "2026-07-24T00:00:00.000Z",
      p_rows: [
        { geoid: "01003010100", is_disadvantaged: true },
        { geoid: "01001020100", is_disadvantaged: false },
      ],
    });
  });

  it("stops and reports the error when a batch fails", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "constraint violation" } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = { rpc } as any;
    const result = await upsertDesignations(service, {
      sourceId: "cejst-national",
      version: "1.0",
      attribution: "",
      retrievedAt: null,
      rows: [{ geoid: "01003010100", isDisadvantaged: true }],
    });
    expect(result.error).toBe("constraint violation");
  });
});
