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
import {
  DesignationSourceUnavailableError,
  notDeterminedJustice40,
} from "@/lib/data-sources/equity-designation/types";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260724000001_equity_tract_designations.sql"),
  "utf8"
);

// Minimal Supabase-client stub: a chainable .from().select().eq().eq().in().
// It RECORDS the projection, because a stub answers its fixture whatever
// columns were asked for — so a column dropped from the `.select()` would leave
// every assertion below green and the real read returning `undefined`.
function selectClient(
  rows: Array<{ geoid: string; is_disadvantaged: boolean; retrieved_at?: string | null }>,
  error: unknown = null
) {
  const projections: string[] = [];
  const chain = {
    select: (columns: string) => {
      projections.push(columns);
      return chain;
    },
    eq: () => chain,
    in: () => Promise.resolve({ data: rows, error }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { from: () => chain } as any;
  client.__projections = projections;
  return client;
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

/**
 * WHEN THIS DEPLOYMENT CAPTURED THE DESIGNATION — found 2026-08-07 by the
 * unread-column sweep, which showed `retrieved_at` written on every ingest and
 * read by nothing.
 *
 * It matters because of what CEJST is now: a DISCONTINUED federal program,
 * rescinded 2025-01-20, whose last public-domain release OpenPlan ships as a
 * static asset. An operator ingesting their own state's designation list has a
 * copy of something that still changes, and "how current is ours?" is the
 * question a planner defending a Justice40 finding gets asked. The answer was
 * in the database and on no screen.
 */
describe("a designation says when this deployment captured it", () => {
  it("asks the database for the capture date it reports", () => {
    const client = selectClient([]);
    void loadDesignationsFromDb(client, { sourceId: "calenviroscreen-ca", version: "4.0", geoids: ["06001400100"] });
    expect(client.__projections[0]).toContain("retrieved_at");
  });

  it("reports the MOST RECENT capture among the rows it read", async () => {
    // A partial refresh leaves rows of two ages. The older one would understate
    // how current the answer is; a fixed one would overstate it for the rest.
    const client = selectClient([
      { geoid: "06001400100", is_disadvantaged: true, retrieved_at: "2026-07-24T00:00:00.000Z" },
      { geoid: "06001400200", is_disadvantaged: false, retrieved_at: "2026-08-01T00:00:00.000Z" },
      { geoid: "06001400300", is_disadvantaged: true, retrieved_at: "2026-06-01T00:00:00.000Z" },
    ]);

    const result = await loadDesignationsFromDb(client, {
      sourceId: "calenviroscreen-ca",
      version: "4.0",
      geoids: ["06001400100", "06001400200", "06001400300"],
    });

    expect(result.retrievedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reports null when the source records no capture date, and never a substitute", async () => {
    // A bundled static asset has no capture date of its own. Null is "not
    // recorded" — the one thing it must not become is today's date, which would
    // date the designation by when somebody happened to look at it.
    const client = selectClient([{ geoid: "06001400100", is_disadvantaged: true }]);

    const result = await loadDesignationsFromDb(client, {
      sourceId: "calenviroscreen-ca",
      version: "4.0",
      geoids: ["06001400100"],
    });

    expect(result.retrievedAt).toBeNull();
  });

  it("carries the capture date onto the determination a planner reads", async () => {
    const client = selectClient([
      { geoid: "06001400100", is_disadvantaged: true, retrieved_at: "2026-07-24T00:00:00.000Z" },
    ]);
    const determination = await resolveJustice40ForTracts(
      { minLon: -122, minLat: 37, maxLon: -121.9, maxLat: 37.1 },
      ["06001400100"],
      [createDbDesignationAdapter(CA_DESCRIPTOR, client)]
    );

    expect(determination.status).toBe("disadvantaged");
    expect(determination.retrievedAt).toBe("2026-07-24T00:00:00.000Z");
    // The dataset's OWN vintage is a different fact and both must survive.
    expect(determination.vintage).toBe("2010");
  });

  it("says nothing rather than something when no source ran", () => {
    expect(notDeterminedJustice40(12).retrievedAt).toBeNull();
  });

  it("leaves the determination's capture date NULL when the source records none", async () => {
    // THE MUTATION THIS EXISTS FOR, and it survived the first version of this
    // file: `lookup.retrievedAt ?? new Date().toISOString()` passed everything.
    // The previous test proves the LOADER returns null; nothing proved the
    // determination kept it that way — and substituting "now" is the specific
    // lie that matters here, because it would date a civil-rights designation
    // by the moment somebody happened to open the page.
    const client = selectClient([{ geoid: "06001400100", is_disadvantaged: true }]);

    const determination = await resolveJustice40ForTracts(
      { minLon: -122, minLat: 37, maxLon: -121.9, maxLat: 37.1 },
      ["06001400100"],
      [createDbDesignationAdapter(CA_DESCRIPTOR, client)]
    );

    expect(determination.status).toBe("disadvantaged");
    expect(determination.retrievedAt).toBeNull();
  });
});
