import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ACTIVITY_SELECT } from "@/app/api/assistant-activity/summary";

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
