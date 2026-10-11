import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGrantInventory, parseGrantStatement } from "./grant-inventory";

describe("public grant inventory schema scope", () => {
  it("ignores private blanket statements and retains public schema lists", () => {
    expect(parseGrantStatement("REVOKE ALL ON ALL TABLES IN SCHEMA openplan_gtfs FROM authenticated")).toBeNull();
    expect(parseGrantStatement('GRANT SELECT ON ALL TABLES IN SCHEMA "openplan_gtfs" TO authenticated')).toBeNull();
    for (const schemas of ['public', '"public"', 'openplan_gtfs, public']) {
      expect(parseGrantStatement(`REVOKE SELECT ON ALL TABLES IN SCHEMA ${schemas} FROM authenticated`))
        .toMatchObject({ kind: "revoke", reach: "blanket", roles: ["authenticated"] });
    }
  });

  it("keeps public and unqualified named tables without absorbing private tables", () => {
    expect(parseGrantStatement("GRANT SELECT ON TABLE openplan_gtfs.widgets TO authenticated")).toBeNull();
    expect(parseGrantStatement('REVOKE ALL ON "openplan_gtfs"."widgets" FROM authenticated')).toBeNull();
    expect(parseGrantStatement('GRANT SELECT ON public.widgets, openplan_gtfs.widgets, "public"."notes", reminders TO authenticated')?.tables)
      .toEqual(["widgets", "notes", "reminders"]);
  });

  it("replays private revokes without removing a public table's grant", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openplan-grant-schemas-"));
    try {
      writeFileSync(path.join(dir, "0001_tables.sql"), `
        CREATE TABLE public.widgets (id uuid);
        GRANT SELECT ON public.widgets TO authenticated;
      `);
      writeFileSync(path.join(dir, "0002_private.sql"), `
        REVOKE ALL ON ALL TABLES IN SCHEMA openplan_gtfs FROM PUBLIC, anon, authenticated, service_role;
        REVOKE ALL ON TABLE openplan_gtfs.widgets FROM authenticated;
      `);
      const grants = loadGrantInventory({ dir });
      expect(grants.holds("widgets", "authenticated", "SELECT")).toBe("table");
      expect(grants.events().filter((event) => event.file === "0002_private.sql")).toEqual([]);
      writeFileSync(path.join(dir, "0003_public.sql"), "REVOKE SELECT ON ALL TABLES IN SCHEMA openplan_gtfs, public FROM authenticated;");
      expect(loadGrantInventory({ dir }).holds("widgets", "authenticated", "SELECT")).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
