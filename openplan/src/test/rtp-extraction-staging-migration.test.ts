import { describe, expect, it } from "vitest";

import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { readMigration } from "./migrations/read-migrations";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import { loadPolicyInventory, classifyWorkspaceScope, WRITE_COMMANDS } from "./migrations/policy-inventory";
import { loadGrantInventory } from "./migrations/grant-inventory";

/**
 * RTP DOCUMENT EXTRACTION — the staging floor (20260811000008) and the
 * provenance thread back to it (20260811000009).
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: extraction is TRANSCRIPTION WITH
 * PROVENANCE, never authorship. A figure may not reach an RTP table through
 * this lane without a verbatim quote, a page, and a human who accepted both.
 *
 * The reason that rule needs a test rather than a paragraph is the 2026-08-05
 * refusals. Five RTP financial writes were refused as assistant actions because
 * a model would have INVENTED the number; the whole argument for this feature is
 * that a transcribed number comes from page 112 of the plan the board adopted
 * instead. That argument is only true while three things stay true — no action
 * is registered, no candidate carries a value without its quote, and no
 * confidence score exists for anything to auto-accept on. Each is asserted
 * below, and each is asserted against the ARTIFACT (the parsed schema, the
 * parsed policies, the parsed grants, the real registry) rather than against a
 * sentence in a comment.
 *
 * WHY SO MUCH OF THIS IS DERIVED RATHER THAN GREPPED. A regex over migration
 * text answers "does the file say X", which is the question a comment can
 * satisfy. Where a parser exists — schema, policy and grant inventories in
 * `src/test/migrations/` — it is used instead, so the assertion is about the
 * schema these files produce. The text assertions that remain cover CHECK
 * constraints and FK actions, which no inventory models yet; they run against
 * comment-stripped SQL, because a header that NAMES a forbidden construct while
 * explaining its absence must not satisfy a matcher looking for it.
 *
 * MUTATION-VERIFIED 2026-08-11. Every assertion below was checked by reverting
 * the thing it guards and confirming this file fails for the right reason —
 * recorded in the session report rather than here, because a comment claiming a
 * test was verified is exactly the shape this repository has been burned by.
 */

const STAGING = "20260811000008_rtp_extraction_staging.sql";
const PROVENANCE = "20260811000009_rtp_extraction_provenance.sql";

const stagingSql = readMigration(STAGING);
const provenanceSql = readMigration(PROVENANCE);

/**
 * Executable statements only. A header may legitimately name a construct it is
 * arguing AGAINST — this one names `assign_rtp_project_horizon_band` and the
 * word "confidence" on purpose — and a matcher that could not tell the two
 * apart would either pass vacuously or fail on the argument.
 */
function executable(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

/**
 * Executable DDL with the `COMMENT ON` statements removed as well.
 *
 * A COMMENT is documentation that happens to be executable — the database's own
 * copy of the header — and it argues against the same constructs the header
 * does. `quote_verified`'s comment says in as many words that it is "NOT a
 * confidence score", which a matcher looking for that phrase cannot tell from
 * the thing it is hunting. Stripped here for the same reason `--` lines are, and
 * NOT by a `COMMENT ON[\s\S]*?;` regex: the comment bodies contain semicolons of
 * their own, so that pattern would cut one in half and leave the tail behind.
 */
function declarative(sql: string): string {
  const lines = executable(sql).split("\n");
  const kept: string[] = [];
  let inComment = false;
  for (const line of lines) {
    if (!inComment && /^COMMENT ON\b/.test(line.trimStart())) {
      inComment = true;
    }
    if (inComment) {
      if (/';\s*$/.test(line)) inComment = false;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

const staging = declarative(stagingSql);
const provenance = declarative(provenanceSql);

const RUNS = "rtp_extraction_runs";
const CANDIDATES = "rtp_extraction_candidates";

/** The four RTP tables an accepted candidate can become a row in. */
const PROVENANCE_TABLES = [
  "rtp_financial_assumptions",
  "rtp_performance_measures",
  "rtp_horizon_bands",
  "project_rtp_cycle_links",
] as const;

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();
const grants = loadGrantInventory();

describe("the RTP extraction staging floor", () => {
  it("parses a schema big enough to be answering the question", () => {
    // Without this every assertion below could pass by parsing nothing — the
    // failure that makes a guard worse than none.
    expect(schema.tables().length).toBeGreaterThan(110);
    expect(policies.all().length).toBeGreaterThan(400);
    expect(grants.denials().length).toBeGreaterThan(100);
    expect(stagingSql.length).toBeGreaterThan(4000);
  });

  it("creates the two staging tables with row security on", () => {
    for (const table of [RUNS, CANDIDATES]) {
      expect(schema.tables()).toContain(table);
      expect(schema.rlsEnabled(table), `${table} must have row security enabled`).toBe(true);
    }
  });

  it("never lets a candidate exist without the page and the words it came from", () => {
    // The three columns that make this transcription rather than authorship.
    for (const column of ["source_page", "source_quote", "quote_verified"]) {
      expect(schema.hasColumn(CANDIDATES, column), `${CANDIDATES}.${column}`).toBe(true);
    }

    expect(staging).toMatch(/source_page INTEGER NOT NULL CHECK \(source_page >= 1\)/);
    expect(staging).toMatch(/source_quote TEXT NOT NULL CHECK \(btrim\(source_quote\) <> ''\)/);
    expect(staging).toMatch(/quote_verified BOOLEAN NOT NULL/);
  });

  it("refuses acceptance of a candidate whose quote was never verified", () => {
    /**
     * THE RULE, AS A CONSTRAINT. Today the verifier discards unverified
     * candidates before insert, so this should be unreachable — which is the
     * point. The day someone stages the discards "so the planner can see
     * them", the accept path must fail closed at the database rather than
     * quietly become a machine authoring a planning number.
     */
    expect(staging).toMatch(/CONSTRAINT rtp_extraction_candidates_accepted_only_when_verified CHECK \(\s*status <> 'accepted' OR quote_verified\s*\)/);
  });

  it("makes an accepted candidate name the row it became, and a pending one name nothing", () => {
    expect(staging).toMatch(/CONSTRAINT rtp_extraction_candidates_review_shape CHECK \(/);
    expect(staging).toMatch(/status = 'pending' AND reviewed_at IS NULL AND accepted_row_id IS NULL/);
    expect(staging).toMatch(/status = 'rejected' AND reviewed_at IS NOT NULL AND accepted_row_id IS NULL/);
    expect(staging).toMatch(/status = 'accepted' AND reviewed_at IS NOT NULL AND accepted_row_id IS NOT NULL/);

    // `reviewed_by` is deliberately absent from that shape: auth.users deletion
    // sets it NULL, and a CHECK requiring it would make deleting a user fail
    // against every candidate they ever reviewed.
    expect(staging).toMatch(/reviewed_by UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
    expect(staging).not.toMatch(/review_shape CHECK \([^;]*reviewed_by/);
  });

  it("has no confidence score, and no column a threshold could ever be put on", () => {
    /**
     * A model scoring its own certainty is the model grading itself, and
     * auto-accepting above a threshold is the single change that would turn
     * this feature back into the thing the 2026-08-05 refusals refused. The
     * absence is asserted over the PARSED COLUMN SET, not the file text, so a
     * column added by a later migration to either table fails here too.
     */
    const forbidden = /confidence|certainty|likelihood|probability|plausib|_score\b|\bscore_/i;

    for (const table of [RUNS, CANDIDATES]) {
      const offenders = [...(schema.columns(table) ?? [])].filter((column) => forbidden.test(column));
      expect(
        offenders,
        `${table} grew a self-assessment column. A model's own confidence is not evidence, and a ` +
          `threshold over it auto-accepts a planning number no human read.`
      ).toEqual([]);
    }

    // And nothing in the executable SQL introduces the vocabulary either — the
    // header argues about it at length, which is why this reads the stripped
    // text.
    expect(staging).not.toMatch(forbidden);
  });

  it("stages a project as a name for a human to bind, never as an id the model chose", () => {
    // Q6: `programmed_project` candidates carry a NAME STRING inside
    // proposed_json; the reviewer binds it to a real project or declines. No
    // project_id column exists for a fuzzy matcher to fill in.
    expect(schema.hasColumn(CANDIDATES, "proposed_json")).toBe(true);
    expect(schema.hasColumn(CANDIDATES, "project_id"), "a project must be bound by a person").toBe(false);
    expect(schema.hasColumn(CANDIDATES, "horizon_band_id")).toBe(false);
    expect(schema.hasColumn(CANDIDATES, "measure_key")).toBe(false);
  });

  it("admits the six target kinds, chapter blocks included, and no verdict", () => {
    // Q3 put chapters in scope as strictly verbatim blocks; Q5 made the cycle's
    // financial basis a target because accepting one re-derives every escalated
    // figure in the plan.
    expect(staging).toMatch(/target_kind TEXT NOT NULL CHECK \(target_kind IN \(/);
    for (const kind of [
      "financial_line",
      "performance_measure",
      "horizon_band",
      "programmed_project",
      "cycle_financial_basis",
      "chapter_block",
    ]) {
      expect(staging).toContain(`'${kind}'`);
    }
    // The fiscal verdict is COMPUTED from accepted rows and has no column
    // anywhere in the product; extraction supplies inputs to that arithmetic
    // and may never state its answer.
    expect(staging).not.toMatch(/verdict|constrained|over_committed|not_determined/i);
  });

  it("keeps a failed run honest: it names its failure and produces nothing", () => {
    expect(staging).toMatch(/status TEXT NOT NULL DEFAULT 'running'\s*\n?\s*CHECK \(status IN \('running', 'succeeded', 'failed'\)\)/);
    expect(staging).toMatch(/CONSTRAINT rtp_extraction_runs_failure_reason_shape CHECK \(/);
    expect(staging).toMatch(/status = 'failed' AND failure_reason IS NOT NULL AND btrim\(failure_reason\) <> ''/);
    expect(staging).toMatch(/status <> 'failed' AND failure_reason IS NULL/);
    expect(staging).toMatch(/CONSTRAINT rtp_extraction_runs_failed_produces_nothing CHECK \(\s*status <> 'failed' OR candidate_count = 0\s*\)/);

    // The discard count is surfaced, not hidden: a review header showing only
    // what survived would present a clean extraction and conceal how much of it
    // the model got wrong.
    expect(schema.hasColumn(RUNS, "discarded_count")).toBe(true);
  });

  it("refuses a text source that cannot answer 'which page?'", () => {
    // Narrower than kb_documents.extraction_source on purpose: pasted text has
    // no pages and a stored file has no text, so neither can be transcribed
    // FROM. A source with no page anchor is refused rather than degraded into a
    // candidate with a blank citation.
    expect(staging).toMatch(/extraction_source TEXT NOT NULL CHECK \(extraction_source IN \('text_layer', 'ocr'\)\)/);
    expect(staging).not.toMatch(/extraction_source[^;]*'pasted'/);
  });

  it("will not let the document behind an accepted figure be deleted", () => {
    // Q1, on the rtp_financial_assumptions.horizon_band_id precedent: a deleted
    // document strands every provenance citation its figures carry on the
    // public plan page. The delete route refuses by name and states the count.
    expect(staging).toMatch(
      /kb_document_id UUID NOT NULL REFERENCES public\.kb_documents\(id\) ON DELETE RESTRICT/
    );
    // The lookup that refusal's count runs on.
    expect(staging).toMatch(/ON public\.rtp_extraction_runs\(kb_document_id, created_at DESC\)/);
  });

  it("keeps a reviewed candidate when the document is re-indexed", () => {
    // Chunks are replaced by a re-extraction. A candidate a planner already
    // reviewed must not evaporate with them — the page and the quote are the
    // durable record, the chunk pointer is a convenience.
    expect(staging).toMatch(
      /source_chunk_id UUID REFERENCES public\.kb_document_chunks\(id\) ON DELETE SET NULL/
    );
    expect(staging).toMatch(/run_id UUID NOT NULL REFERENCES public\.rtp_extraction_runs\(id\) ON DELETE CASCADE/);
  });
});

describe("the staging tables are service-role-written and member-read", () => {
  it("gives each table exactly one policy: a workspace member SELECT", () => {
    for (const table of [RUNS, CANDIDATES]) {
      const all = policies.forTable(table);
      expect(all.map((p) => `${p.kind} ${p.command} ${p.policy}`).sort()).toEqual([
        `PERMISSIVE SELECT ${table}_member_read`,
      ]);
      expect(classifyWorkspaceScope(all[0]).kind, `${table}'s read policy must reach a workspace`).toBe(
        "matched"
      );
    }
  });

  it("grants no client write policy at all — a client-written candidate never met the verifier", () => {
    for (const table of [RUNS, CANDIDATES]) {
      for (const command of WRITE_COMMANDS) {
        expect(
          policies.permissiveGrants(table, command).map((p) => p.policy),
          `${table} must have no permissive ${command} policy: a row written straight through ` +
            `PostgREST is a candidate claiming a quote the verifier never checked.`
        ).toEqual([]);
        // And therefore no RESTRICTIVE companion gate either — the reason this
        // migration moves none of viewer-write-denial-guard's three equalities.
        expect(policies.restrictiveGates(table, command)).toEqual([]);
      }
    }
  });

  it("lets authenticated read and nothing else, and anon nothing at all", () => {
    const denials = grants.denials();

    for (const table of [RUNS, CANDIDATES]) {
      const forTable = denials.filter((denial) => denial.table === table);
      expect(forTable.length, `${table} must appear in the revoke replay at all`).toBeGreaterThan(0);

      const held = (role: string, privilege: string) =>
        forTable.find((d) => d.role === role && d.privilege === privilege)?.heldBy ?? null;

      expect(held("authenticated", "SELECT"), `${table}: members must be able to read`).not.toBeNull();
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect(
          held("authenticated", privilege),
          `${table}: authenticated holds ${privilege}. Writes go through an authed route with the ` +
            `service role; a direct client write bypasses the verifier entirely.`
        ).toBeNull();
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(
          held("anon", privilege),
          `${table}: anon holds ${privilege}. Unreviewed transcription — including the verbatim ` +
            `quotes — would be readable by anyone holding the public key.`
        ).toBeNull();
      }

      expect(forTable.filter((denial) => denial.violation)).toEqual([]);
    }
  });

  it("does not copy the column-scoped grant posture that failed once", () => {
    // document_narrative_drafts grants members a column-scoped UPDATE, and
    // 20260804000002's blanket grant silently widened it to a table-wide one
    // until 20260805000005 repaired it by hand. "SELECT and nothing else" has
    // no moving part to widen.
    expect(staging).not.toMatch(/GRANT UPDATE \(/);
    expect(staging).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/);
    expect(staging).toMatch(/GRANT SELECT ON TABLE public\.rtp_extraction_runs TO authenticated/);
    expect(staging).toMatch(/GRANT SELECT ON TABLE public\.rtp_extraction_candidates TO authenticated/);
  });

  it("revokes before it grants, so the revoke cannot destroy the grant", () => {
    // Postgres revokes column privileges along with table-level ones, so a
    // revoke placed after the grant erases it — the ordering trap 20260805000005
    // documents at length.
    const revoke = staging.indexOf("REVOKE ALL ON TABLE public.rtp_extraction_runs");
    const grant = staging.indexOf("GRANT SELECT ON TABLE public.rtp_extraction_runs TO authenticated");
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(grant).toBeGreaterThan(revoke);
  });
});

describe("this lane registers no assistant action", () => {
  it("leaves the action registry at exactly the twelve kinds it had", () => {
    /**
     * THE LOAD-BEARING PROPERTY. `refused-rtp-financial-actions-stay-refused`
     * enumerates `Object.keys(ACTION_METADATA)` and nothing else, so it stays
     * green BY CONSTRUCTION here — there is no new key for it to see. That is a
     * structural fact and not an allowlist, and this assertion is what keeps it
     * one: extraction and acceptance are HTTP routes a signed-in human calls.
     */
    expect(Object.keys(ACTION_METADATA)).toHaveLength(12);
  });

  it("registers nothing that could create, verify or accept a candidate", () => {
    const suspicious = Object.keys(ACTION_METADATA).filter((kind) =>
      /extract|candidate|transcri|ingest_document|accept_/.test(kind)
    );
    expect(
      suspicious,
      `${suspicious.join(", ")} was registered. Extraction values and their acceptance are the ` +
        `human's half of this feature: an agent that can author a candidate's VALUES, or accept ` +
        `one, is the 2026-08-05 refusal reopened with a document-shaped excuse in front of it.`
    ).toEqual([]);

    // Guard the guard: the matcher would catch the plausible spellings.
    const pretend = [
      "create_rtp_extraction_run",
      "accept_rtp_extraction_candidate",
      "transcribe_rtp_document",
      "create_funding_opportunity", // innocent bystander
    ];
    expect(pretend.filter((kind) => /extract|candidate|transcri|ingest_document|accept_/.test(kind))).toEqual([
      "create_rtp_extraction_run",
      "accept_rtp_extraction_candidate",
      "transcribe_rtp_document",
    ]);
  });
});

describe("provenance reaches back from an accepted figure to its page", () => {
  it("adds one nullable candidate reference to each of the four target tables", () => {
    for (const table of PROVENANCE_TABLES) {
      expect(schema.hasColumn(table, "extraction_candidate_id"), `${table}`).toBe(true);
      expect(provenance).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${table}\\s*\\n\\s*ADD COLUMN IF NOT EXISTS extraction_candidate_id UUID\\s*\\n\\s*REFERENCES public\\.rtp_extraction_candidates\\(id\\) ON DELETE SET NULL`
        )
      );
    }
  });

  it("keeps the accepted figure when its staging record goes away", () => {
    // ON DELETE SET NULL, not CASCADE and not RESTRICT. The RESTRICT that
    // matters is one level up on the source document. A real number in a real
    // adopted plan does not stop being one because its staging row was removed
    // — it reverts to reading like every hand-typed figure beside it.
    expect(provenance.match(/ON DELETE SET NULL/g)).toHaveLength(PROVENANCE_TABLES.length);
    expect(provenance).not.toMatch(/extraction_candidate_id[^;]*ON DELETE CASCADE/);
    // The column itself is nullable. (`WHERE extraction_candidate_id IS NOT
    // NULL` on the partial indexes is a different thing, and an earlier
    // spelling of this assertion matched it and failed for the wrong reason.)
    expect(provenance).not.toMatch(/extraction_candidate_id UUID NOT NULL/);
  });

  it("invents provenance for nothing that already exists", () => {
    // NULL means TYPED BY HAND, permanently. A backfill guessing which
    // historical figures "probably" came from a document would be inventing
    // provenance, which is worse than having none.
    expect(provenance).not.toMatch(/\bUPDATE\b/i);
    expect(provenance).not.toMatch(/\bDEFAULT\b/i);
  });

  it("does not denormalize the document, the page and the quote onto four tables", () => {
    // Twelve columns instead of four, each a copy of data the candidate holds
    // immutably, each free to drift. The join is always correct.
    for (const column of ["source_page", "source_quote", "kb_document_id", "source_document_id"]) {
      for (const table of PROVENANCE_TABLES) {
        expect(schema.hasColumn(table, column), `${table}.${column} must not be a copy`).toBe(false);
      }
    }
  });

  it("leaves the cycle and its chapters alone", () => {
    // A cycle is not a transcribed artifact. Chapter text never reaches
    // content_markdown from this lane at all — it lands in
    // document_narrative_drafts, which carries its own grounding record, and a
    // second provenance column there would be two answers to one question.
    expect(schema.hasColumn("rtp_cycles", "extraction_candidate_id")).toBe(false);
    expect(schema.hasColumn("rtp_cycle_chapters", "extraction_candidate_id")).toBe(false);
    expect(schema.hasColumn("document_narrative_drafts", "extraction_candidate_id")).toBe(false);
  });
});

describe("neither migration destroys anything", () => {
  it("drops no table, no column, and deletes no row", () => {
    for (const sql of [stagingSql, provenanceSql]) {
      expect(sql).not.toMatch(/DROP TABLE/i);
      expect(sql).not.toMatch(/DROP COLUMN/i);
      expect(sql).not.toMatch(/DROP CONSTRAINT/i);
      expect(sql).not.toMatch(/\bDELETE FROM\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b(?!,)/i);
    }
  });

  it("creates everything additively so a re-run is safe", () => {
    expect(staging.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(staging.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(6);
    expect(provenance.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
    expect(provenance.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(4);
    // Policy creation is guarded the same way.
    expect(staging.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/g)).toHaveLength(2);
  });
});
