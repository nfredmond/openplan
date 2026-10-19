import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseStoredDraft } from "@/lib/reports/narrative-drafts";
import { readTranscribedChapterGrounding } from "@/lib/rtp/extraction/chapter-blocks";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { LIVE_RLS } from "./local-supabase-env";

// These fixtures exercise actual roles and rollback every synthetic row.
// They do not prove HTTP authorization, concurrent writers or real chapter IDs.
(LIVE_RLS ? describe : describe.skip)("manual retained-page database boundaries", () => {
  let container: string;

  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated OPENPLAN_SUPABASE_WORKDIR for live RTP tests.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(file: string): string {
    const fixture = readFileSync(resolve(process.cwd(), "src/test/fixtures/rtp", file), "utf8");
    expect(fixture.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    const marker = "RTP_MANUAL_FIXTURE_REACHED_ROLLBACK";
    const boundary = fixture.lastIndexOf("ROLLBACK;");
    const input = fixture.slice(0, boundary) + `SELECT '${marker}';\n` + fixture.slice(boundary);
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
      input,
      encoding: "utf8",
      timeout: 40_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.error, "native fixture process must start and finish").toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split(/\r?\n/)).toContain(marker);
    expect(result.stdout.trimEnd().endsWith("ROLLBACK")).toBe(true);
    return result.stdout;
  }

  it("refuses drift and replay changes, preserves immutable source, and rolls back failed inserts", () => {
    exercise("manual-source-page-proposals.sql");
  }, 45_000);

  it("enforces actual caller roles and reads the database's null-model manual drafts", () => {
    const output = exercise("manual-native-role-followups.sql");
    const rows: unknown[] = output.split(/\r?\n/).filter((line) => line.startsWith("RTP_MANUAL_DRAFT:")).map((line) => JSON.parse(line.slice("RTP_MANUAL_DRAFT:".length)));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const draft = parseStoredDraft(row);
      expect(draft).not.toBeNull();
      if (!draft) throw new Error("Database manual draft failed application parsing");
      expect(draft.target_kind).toBe("rtp_chapter");
      expect(draft.model).toBeNull();
      expect(draft.facts_hash).toBe("SYNTHETIC-not-a-route-facts-hash");
      const source = row as { grounding_json: { retained_source: unknown; extraction_candidate_id: string; source_quote: string } };
      const grounding = readTranscribedChapterGrounding(draft.grounding_json);
      expect(grounding).not.toBeNull();
      expect(grounding?.source_method).toBe("manual_retained_page");
      expect(grounding?.retained_source).toEqual(source.grounding_json.retained_source);
      expect(grounding?.extraction_candidate_id).toBe(source.grounding_json.extraction_candidate_id);
      expect(grounding?.source_quote).toBe(source.grounding_json.source_quote);
      expect(grounding?.chunk_recheck).toBe("retained_page_matched");
    }
  }, 45_000);
});
