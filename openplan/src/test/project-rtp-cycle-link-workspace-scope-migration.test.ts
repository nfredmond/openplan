import { describe, expect, it } from "vitest";

import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import trustedSearchPaths from "./fixtures/application-trusted-search-paths.json";

/**
 * Migration-content guard for 20261102140000 (KI-2026-11-02-053).
 *
 * A link row names a workspace, a project and a cycle, and until this migration
 * nothing made the three agree: a member of one workspace could store a link
 * against another workspace's cycle or project through the Data API, and the
 * service-role public plan pages would publish it. The trigger refuses such a
 * row. This file reads the SQL because the qa gate has no database; the
 * behaviour itself is proved only by a live run, which this file is not.
 */

const MIGRATION = "20261102140000_project_rtp_cycle_link_workspace_scope.sql";
const sql = blankComments(readMigration(MIGRATION));

/** The body of one `CREATE OR REPLACE FUNCTION public.<name>()`, up to its closing `$$;`. */
function functionBody(name: string): string {
  const match = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`)
  );
  expect(match, `${name} is not defined`).toBeTruthy();
  return match![1];
}

function functionHeader(name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)([\\s\\S]*?)AS \\$\\$`));
  expect(match, `${name} is not defined`).toBeTruthy();
  return match![1];
}

describe("an RTP project link stays inside one workspace", () => {
  it("sorts after main's latest migration and inside this change's version range", () => {
    const files = migrationFiles();
    expect(files).toContain(MIGRATION);
    const version = MIGRATION.slice(0, 14);
    expect(version >= "20261102140000" && version <= "20261102149999").toBe(true);
    expect(files.filter((file) => file.startsWith(version))).toEqual([MIGRATION]);
  });

  it("refuses a link whose project or cycle belongs to another workspace", () => {
    const body = functionBody("guard_project_rtp_cycle_link_scope");
    expect(body).toMatch(
      /FROM public\.projects p\s+WHERE p\.id = NEW\.project_id AND p\.workspace_id <> NEW\.workspace_id/
    );
    expect(body).toMatch(
      /FROM public\.rtp_cycles c\s+WHERE c\.id = NEW\.rtp_cycle_id AND c\.workspace_id <> NEW\.workspace_id/
    );
    expect(body).toMatch(/RAISE EXCEPTION 'An RTP project link must stay inside one workspace'/);
  });

  it("refuses a band from another cycle or workspace and an evidence run from another workspace", () => {
    const body = functionBody("guard_project_rtp_cycle_link_scope");
    expect(body).toMatch(
      /FROM public\.rtp_horizon_bands b\s+WHERE b\.id = NEW\.horizon_band_id\s+AND \(b\.rtp_cycle_id <> NEW\.rtp_cycle_id OR b\.workspace_id <> NEW\.workspace_id\)/
    );
    expect(body).toMatch(
      /FROM public\.model_runs r\s+WHERE r\.id = NEW\.evidence_model_run_id AND r\.workspace_id <> NEW\.workspace_id/
    );
  });

  /**
   * Refusing a MISSING parent would break cascades: deleting a workspace can
   * remove a project, then set a surviving link's band or run to NULL, which
   * fires this trigger before the link is deleted. The foreign keys already
   * refuse a missing parent on a real insert or update.
   */
  it("refuses only a parent that exists elsewhere, never a parent that is missing", () => {
    const body = functionBody("guard_project_rtp_cycle_link_scope");
    expect(body).not.toMatch(/NOT EXISTS/);
    expect(body.match(/\bEXISTS \(/g)?.length).toBe(4);
  });

  it("checks every insert and every update that changes a column naming another record", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER project_rtp_cycle_links_workspace_scope\s+BEFORE INSERT OR UPDATE OF workspace_id, project_id, rtp_cycle_id, horizon_band_id, evidence_model_run_id\s+ON public\.project_rtp_cycle_links\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_project_rtp_cycle_link_scope\(\);/
    );
  });

  it("keeps a project or cycle with links from moving to another workspace", () => {
    const body = functionBody("guard_rtp_link_parent_workspace");
    expect(body).toMatch(/NEW\.workspace_id IS DISTINCT FROM OLD\.workspace_id AND EXISTS/);
    expect(body).toMatch(/TG_TABLE_NAME = 'projects' AND l\.project_id = OLD\.id/);
    expect(body).toMatch(/TG_TABLE_NAME = 'rtp_cycles' AND l\.rtp_cycle_id = OLD\.id/);
    for (const table of ["projects", "rtp_cycles"]) {
      expect(sql).toMatch(
        new RegExp(
          `BEFORE UPDATE OF workspace_id ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.guard_rtp_link_parent_workspace\\(\\);`
        )
      );
    }
  });

  it("runs both guards as their owner on a trusted path, and no client role can call them", () => {
    for (const name of ["guard_project_rtp_cycle_link_scope", "guard_rtp_link_parent_workspace"]) {
      const header = functionHeader(name);
      expect(header).toMatch(/RETURNS trigger/);
      expect(header).toMatch(/SECURITY DEFINER/);
      expect(header).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${name}\\(\\) FROM PUBLIC, anon, authenticated, service_role;`
        )
      );
      // The live search-path probe checks the installed setting of every name it lists.
      expect(trustedSearchPaths).toContain(`${name}()`);
    }
  });

  it("names every table it reads with its schema", () => {
    for (const name of ["guard_project_rtp_cycle_link_scope", "guard_rtp_link_parent_workspace"]) {
      const body = functionBody(name);
      const unqualified = [...body.matchAll(/\bFROM\s+(?!public\.)([a-z_]+)/g)].map((match) => match[1]);
      expect(unqualified, `${name} reads an unqualified table`).toEqual([]);
    }
  });
});
