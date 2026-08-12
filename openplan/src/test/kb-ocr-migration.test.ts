import { describe, expect, it } from "vitest";

import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { KB_OCR_JOB_STATUSES } from "@/lib/knowledge-base/ocr-contract";

/**
 * 20260811000010 — the document library learns to read a scanned file.
 *
 * Structural assertions against the parsed migrations (the
 * aerial-imagery-migration arrangement), so they hold with no live database.
 *
 * What matters here, in order of what a mistake would cost:
 *   1. the write posture is the CUSTODY one — member SELECT only, no client
 *      write policy anywhere — because a client-written OCR job row would be a
 *      way to make a document claim text nobody recognised;
 *   2. the callback ledger's `callback_id` is UNIQUE, which is the only thing
 *      standing between a redelivered callback and every excerpt in the
 *      document appearing twice in search;
 *   3. nothing destructive, and nothing that drops a row;
 *   4. no confidence/accuracy column, ever.
 */

const MIGRATION = "20260811000010_kb_ocr_extraction_source.sql";

// Comments are BLANKED before any regex runs: this test asserts on SQL that
// executes, never on prose (the prose-is-not-the-artifact lesson).
const migrationSql = blankComments(readMigration(MIGRATION));

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("kb OCR migration", () => {
  it("is in the migration set at all (this suite is not reading an empty file)", () => {
    expect(migrationFiles()).toContain(MIGRATION);
    expect(migrationSql.length).toBeGreaterThan(500);
  });

  it("creates kb_ocr_jobs with every column the routes project", () => {
    expect(schema.tables()).toContain("kb_ocr_jobs");

    for (const column of [
      "id",
      "workspace_id",
      "document_id",
      "request_id",
      "worker_job_id",
      "status",
      "progress",
      "message",
      "page_count",
      "pages_with_text",
      "engine_name",
      "engine_version",
      "languages",
      "failure_detail",
      "last_callback_id",
      "last_callback_at",
      "requested_by",
      "created_at",
      "updated_at",
    ]) {
      expect(schema.hasColumn("kb_ocr_jobs", column), `missing ${column}`).toBe(true);
    }
  });

  it("creates the callback ledger with a UNIQUE callback_id", () => {
    expect(schema.tables()).toContain("kb_ocr_job_callbacks");
    for (const column of [
      "ocr_job_id",
      "workspace_id",
      "callback_id",
      "status",
      "occurred_at",
      "page_count",
      "payload_bytes",
      "created_at",
    ]) {
      expect(schema.hasColumn("kb_ocr_job_callbacks", column), `missing ${column}`).toBe(true);
    }

    // THE assertion in this file. Without UNIQUE, a redelivered succeeded
    // callback re-runs the chunk insert and every excerpt in the document
    // appears twice in search — with no error anywhere to notice it by.
    expect(migrationSql).toMatch(/callback_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  it("scopes both tables to a workspace and cascades from the document", () => {
    expect(schema.childrenOf("workspaces")).toContain("kb_ocr_jobs");
    expect(schema.childrenOf("workspaces")).toContain("kb_ocr_job_callbacks");
    expect(schema.childrenOf("kb_documents")).toContain("kb_ocr_jobs");
    expect(schema.childrenOf("kb_ocr_jobs")).toContain("kb_ocr_job_callbacks");
    expect(migrationSql).toMatch(
      /document_id\s+UUID\s+NOT NULL REFERENCES (?:public\.)?kb_documents\(id\) ON DELETE CASCADE/i
    );
  });

  it("makes a second job for the same request unstorable", () => {
    expect(migrationSql).toMatch(/request_id\s+TEXT\s+NOT NULL UNIQUE/i);
  });

  it("pins the job-status vocabulary to the TypeScript one", () => {
    const match = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i.exec(migrationSql);
    expect(match, "no status CHECK found on kb_ocr_jobs").not.toBeNull();
    const database = (match as RegExpExecArray)[1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(database).toEqual([...KB_OCR_JOB_STATUSES].sort());
  });

  it("is member-READ only — no client role may write an OCR job", () => {
    // The custody posture (aerial_imagery, kb_documents). A client-written job
    // row is a way to make a document claim text nobody recognised, so every
    // write goes through an authed route or the bearer-authenticated callback,
    // both with the service role.
    const jobPolicies = policies.forTable("kb_ocr_jobs");
    expect(jobPolicies.map((policy) => policy.command.toUpperCase())).toEqual(["SELECT"]);
    expect(jobPolicies[0].kind).toBe("PERMISSIVE");

    // The ledger has NO policy at all: row security on with zero policies is
    // unreadable by every client role regardless of grants — the strongest of
    // the three postures, and the one aerial_processing_callbacks arrived at
    // the slow way.
    expect(policies.forTable("kb_ocr_job_callbacks")).toEqual([]);
    expect(migrationSql).toMatch(/ALTER TABLE kb_ocr_job_callbacks\s+ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(/ALTER TABLE kb_ocr_jobs\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it("grants authenticated nothing but SELECT, and anon nothing at all", () => {
    expect(migrationSql).toMatch(/GRANT SELECT ON kb_ocr_jobs TO authenticated/i);
    expect(migrationSql).not.toMatch(/GRANT[^;]*\bINSERT\b[^;]*TO authenticated/i);
    expect(migrationSql).not.toMatch(/GRANT[^;]*TO anon/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON kb_ocr_jobs\s+FROM anon/i);
    expect(migrationSql).toMatch(/REVOKE ALL ON kb_ocr_job_callbacks FROM anon, authenticated/i);
  });

  it("destroys nothing", () => {
    for (const destructive of [
      /DROP TABLE/i,
      /ALTER TABLE[^;]*DROP COLUMN/i,
      /^\s*DELETE FROM/im,
      /TRUNCATE/i,
      /^\s*UPDATE /im,
    ]) {
      expect(migrationSql).not.toMatch(destructive);
    }
    // The one DROP it does contain is a CONSTRAINT being replaced by a wider
    // one, which is the only way Postgres widens a CHECK.
    expect(migrationSql).toMatch(/DROP CONSTRAINT IF EXISTS kb_documents_extraction_source_check/i);
  });
});
