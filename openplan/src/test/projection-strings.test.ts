import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTIVITY_SELECT } from "@/lib/assistant/activity-summary";
import { STAGE_GATE_BINDING_WORKSPACE_COLUMNS } from "@/lib/stage-gates/rebind";
import { REPORT_ACCESS_COLUMNS } from "@/lib/reports/api";

/**
 * PROJECTION STRINGS, ASSERTED AS STRINGS — the Stage B closeout of a defect
 * class this repo has already shipped.
 *
 * WHY STRINGS AND NOT MOCKS. Supabase clients here are deliberately untyped, so
 * a `.select()` is never checked against the schema OR against what the surface
 * renders. A mocked client returns its fixture whatever columns were asked for,
 * so deleting a column from a select leaves every mounted-page assertion green
 * while the real page renders `undefined`. The only artifact that decides what
 * the database returns is the projection string itself, so that is what these
 * tests read — straight out of the source file, through the same
 * balanced-parenthesis extraction the read-error detectors use.
 *
 * Each block names the RENDER SITE that consumes the column, because a column
 * nothing renders should be dropped from the select, not defended here. If one
 * of these fails after an intentional column removal, remove the corresponding
 * render too — the assertion is the reminder that it exists.
 *
 * The five surfaces are the ones the 2026-08-03 review ranked: the model-run
 * claim-status loader (the tier firewall's evidence), the funding-awards page
 * (closure provenance), the RTP document page (chapter content), the invoicing
 * composer lane (money figures), and the assistant-activity ledger (authorship).
 */

const ROOT = process.cwd();

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
}

/**
 * The projection string of the FIRST `.select(…)` after `.from("<table>")`.
 * Balanced-paren extraction, then string-literal unwrapping — a projection
 * split over lines or written as a template literal reads the same.
 */
function selectAfterFrom(source: string, table: string): string {
  const fromAt = source.indexOf(`.from("${table}")`);
  expect(fromAt, `no .from("${table}") in the file`).toBeGreaterThanOrEqual(0);
  const selectAt = source.indexOf(".select(", fromAt);
  expect(selectAt, `no .select( after .from("${table}")`).toBeGreaterThanOrEqual(0);

  let depth = 1;
  let end = selectAt + ".select(".length;
  while (end < source.length && depth > 0) {
    if (source[end] === "(") depth += 1;
    else if (source[end] === ")") depth -= 1;
    end += 1;
  }
  return source
    .slice(selectAt + ".select(".length, end - 1)
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the model-run claim-status loader asks for the columns the evidence snapshot reads", () => {
  it("modeling_claim_decisions carries the tier, its reason, and its provenance", () => {
    const projection = selectAfterFrom(
      sourceOf("src/lib/models/evidence-backbone.ts"),
      "modeling_claim_decisions"
    );
    // Rendered by the modeling evidence panel and cited into RTP chapters and
    // grant narratives; claim_status is the tier firewall's own evidence.
    for (const column of ["track", "claim_status", "status_reason", "reasons_json", "validation_summary_json", "decided_at"]) {
      expect(projection, `modeling_claim_decisions select lost "${column}"`).toContain(column);
    }
  });
});

describe("the funding-awards page asks for the closure provenance it renders", () => {
  it("the derived select still contains the closure columns, and the derivation still fires", () => {
    const source = sourceOf("src/app/(app)/grants/page.tsx");
    // The final select is DERIVED: legacy.replace("spending_status," → closure
    // columns). `String.replace` with a missing needle silently returns the
    // input unchanged, so the derivation must be re-run here and proven to
    // have CHANGED the string — asserting the literals separately would stay
    // green while the page quietly selected the legacy column set.
    const legacyMatch = /const FUNDING_AWARD_SELECT_LEGACY =\s*"([^"]+)"/.exec(source);
    const replaceMatch = /FUNDING_AWARD_SELECT_LEGACY\.replace\(\s*"([^"]+)",\s*"([^"]+)"\s*\)/.exec(source);
    expect(legacyMatch, "FUNDING_AWARD_SELECT_LEGACY literal not found").not.toBeNull();
    expect(replaceMatch, "the FUNDING_AWARD_SELECT derivation not found").not.toBeNull();

    const finalSelect = legacyMatch![1].replace(replaceMatch![1], replaceMatch![2]);
    expect(finalSelect, "the closure-column insertion no longer fires — its needle is gone from the legacy select").not.toBe(
      legacyMatch![1]
    );
    // Rendered by the award close-out panel: an earned close-out vs one
    // asserted on import is exactly these four columns.
    for (const column of ["closure_basis", "closed_at", "closure_note", "reopened_at", "spending_status", "awarded_amount"]) {
      expect(finalSelect, `funding_awards select lost "${column}"`).toContain(column);
    }
  });
});

describe("the RTP document page asks for the chapter columns it renders", () => {
  it("rtp_cycle_chapters carries the content and the structure of the document view", () => {
    const projection = selectAfterFrom(
      sourceOf("src/app/(app)/rtp/[rtpCycleId]/document/page.tsx"),
      "rtp_cycle_chapters"
    );
    // content_markdown is the document body itself; sort_order/required/
    // section_type are what the completeness rail computes from.
    for (const column of ["chapter_key", "title", "section_type", "status", "summary", "guidance", "content_markdown", "sort_order", "required"]) {
      expect(projection, `rtp_cycle_chapters select lost "${column}"`).toContain(column);
    }
  });
});

describe("the invoicing composer lane asks for the money columns it renders", () => {
  it("client_invoices carries the figures the receivables board and composer show", () => {
    const projection = selectAfterFrom(
      sourceOf("src/app/(app)/invoicing/_components/receivables-lane.tsx"),
      "client_invoices"
    );
    for (const column of [
      "invoice_number",
      "status",
      "invoice_date",
      "due_date",
      "period_start",
      "period_end",
      "subtotal_amount",
      "retention_percent",
      "retention_amount",
      "total_amount",
      "payment_terms",
    ]) {
      expect(projection, `client_invoices select lost "${column}"`).toContain(column);
    }
  });

  it("invoicing_time_entries carries what unbilled-time selection needs", () => {
    const projection = selectAfterFrom(
      sourceOf("src/app/(app)/invoicing/_components/receivables-lane.tsx"),
      "invoicing_time_entries"
    );
    // billed_line_item_id is how the composer knows an entry is still
    // billable; dropping it silently double-bills every entry.
    for (const column of ["entry_date", "hours", "billable", "labor_category", "billed_line_item_id", "staff_id", "engagement_id"]) {
      expect(projection, `invoicing_time_entries select lost "${column}"`).toContain(column);
    }
  });
});

describe("the assistant-activity ledger asks for the authorship it displays", () => {
  it("the full select carries all four authorship columns and the ledger's core", () => {
    // The page renders "composed by …" from actor_kind/actor_agent_id and the
    // consent line from approved_by_user_id/approved_at; a missing column here
    // silently renders every agent action as a person's.
    for (const column of ["actor_kind", "actor_agent_id", "approved_by_user_id", "approved_at"]) {
      expect(ASSISTANT_ACTIVITY_SELECT, `assistant-activity select lost authorship column "${column}"`).toContain(column);
    }
    for (const column of ["action_kind", "audit_event", "outcome", "completed_at", "workspace_id"]) {
      expect(ASSISTANT_ACTIVITY_SELECT, `assistant-activity select lost core column "${column}"`).toContain(column);
    }
  });
});

describe("the stage-gate binding readers ask for the columns the binding resolves from", () => {
  /**
   * Three surfaces resolve a workspace's stage-gate binding before rendering a
   * gate board: the report detail page (live drift side), the packet generator
   * (the frozen snapshot), and the assistant's project context. Each widened
   * its `workspaces` select by interpolating STAGE_GATE_BINDING_WORKSPACE_COLUMNS
   * — never by retyping it. These assertions re-run that interpolation (the
   * same derivation-proof shape as the funding-awards block above) and then
   * check the two columns that silently change the answer when lost:
   * `stage_gate_template_id` (the binding of record — without it a deliberate
   * binding reads as never chosen) and `home_subdivision_code` (without it a CA
   * workspace looks like a country-level US one and matches the wrong pack).
   */
  const BINDING_READERS = [
    "src/app/(app)/reports/[reportId]/page.tsx",
    "src/app/api/reports/[reportId]/generate/route.ts",
    "src/lib/assistant/context.ts",
  ];

  function resolvedWorkspacesSelects(relativePath: string): string[] {
    const source = sourceOf(relativePath);
    const selects: string[] = [];
    for (const match of source.matchAll(/\.from\("workspaces"\)/g)) {
      const selectAt = source.indexOf(".select(", match.index ?? 0);
      if (selectAt < 0) continue;
      let depth = 1;
      let end = selectAt + ".select(".length;
      while (end < source.length && depth > 0) {
        if (source[end] === "(") depth += 1;
        else if (source[end] === ")") depth -= 1;
        end += 1;
      }
      selects.push(
        source
          .slice(selectAt + ".select(".length, end - 1)
          .replace(/[`"']/g, "")
          .replace(/\s+/g, " ")
          .trim()
          // Both spellings the sources use: interpolated into a template
          // literal, or passed as the bare identifier.
          .replace(
            /\$\{STAGE_GATE_BINDING_WORKSPACE_COLUMNS\}|STAGE_GATE_BINDING_WORKSPACE_COLUMNS/,
            STAGE_GATE_BINDING_WORKSPACE_COLUMNS
          )
      );
    }
    return selects;
  }

  it("the shared projection constant itself still carries the two treacherous columns", () => {
    expect(STAGE_GATE_BINDING_WORKSPACE_COLUMNS).toContain("stage_gate_template_id");
    expect(STAGE_GATE_BINDING_WORKSPACE_COLUMNS).toContain("home_subdivision_code");
  });

  for (const reader of BINDING_READERS) {
    it(`${reader} selects the binding columns on its workspaces read`, () => {
      const selects = resolvedWorkspacesSelects(reader);
      expect(selects.length, `no .from("workspaces").select(…) found in ${reader}`).toBeGreaterThan(0);
      const carriesBinding = selects.filter(
        (projection) =>
          projection.includes("stage_gate_template_id") && projection.includes("home_subdivision_code")
      );
      expect(
        carriesBinding.length,
        `${reader}: no workspaces select carries stage_gate_template_id + home_subdivision_code — the binding cannot be resolved from what this file reads`
      ).toBeGreaterThan(0);
    });
  }
});

/**
 * REPORT ACCESS — the projection and its row type must not drift apart.
 *
 * `SWEEP_B8` in the 2026-08-06 foundation audit was a surviving mutation of "a
 * report-access `.select()` projection" whose exact string pair the sweep
 * harness never recorded, so it could not be re-run. The audit's own note said
 * it was the likeliest of the three unreproducible survivors to be a live
 * defect, because a dropped projection column is precisely the class a mocked
 * Supabase client cannot catch: the fixture answers whatever was asked for.
 *
 * Rather than guess at the original mutation, this closes the class. The
 * projection constant and the `ReportAccessRow` type are two hand-maintained
 * lists of the same columns, in the same file, with nothing tying them
 * together — so either can lose a column while the other keeps it, and every
 * consumer typed against the row would read `undefined` at runtime with the
 * compiler satisfied. Both directions are asserted, because a column in the
 * projection that the type does not carry is dead weight nobody renders.
 */
describe("report access asks for exactly the columns its row type promises", () => {
  const source = sourceOf("src/lib/reports/api.ts");

  /** Field names of a `export type X = { … }` block, read from source. */
  function fieldsOfType(typeName: string): string[] {
    const at = source.indexOf(`export type ${typeName} = {`);
    expect(at, `no ${typeName} in reports/api.ts`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("};", at);
    return source
      .slice(at, end)
      .split("\n")
      .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*)\s*[?]?:/i)?.[1])
      .filter((name): name is string => Boolean(name));
  }

  const projection = REPORT_ACCESS_COLUMNS.split(",").map((column) => column.trim());
  const rowFields = fieldsOfType("ReportAccessRow");

  it("finds both lists, so the comparison below is not vacuous", () => {
    expect(projection.length).toBeGreaterThan(5);
    expect(rowFields.length).toBeGreaterThan(5);
  });

  it("requests every column ReportAccessRow declares", () => {
    // A field the type promises but the select never asks for is `undefined` at
    // runtime, with the compiler and every mocked test satisfied.
    expect([...rowFields].sort()).toEqual([...projection].sort());
  });

  it("still carries the two columns the artifact download depends on", () => {
    // Named explicitly because they are the ones whose absence is silent: a
    // report page renders with no download link rather than erroring.
    expect(projection).toContain("latest_artifact_url");
    expect(projection).toContain("latest_artifact_kind");
    // And the workspace scope, which is the access decision itself.
    expect(projection).toContain("workspace_id");
  });
});
