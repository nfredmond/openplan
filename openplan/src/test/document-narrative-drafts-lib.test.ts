import { describe, expect, it } from "vitest";
import { buildProjectFundingSnapshot } from "@/lib/projects/funding";
import {
  buildReportSectionFacts,
  factsHash,
  parseStoredDraft,
  type ReportSectionFactsInput,
} from "@/lib/reports/narrative-drafts";
import type { NarrativeFact } from "@/lib/grants/narrative-grounding";

function baseInput(): ReportSectionFactsInput {
  return {
    report: {
      title: "Corridor Board Packet",
      summary: "Quarterly packet for the board.",
      report_type: "board_packet",
    },
    project: {
      name: "Main St Bridge",
      summary: "Replace the load-limited bridge.",
      status: "active",
      plan_type: "capital",
      delivery_phase: "design",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    runs: [
      {
        id: "run-1",
        title: "Corridor screening",
        summary_text: "Screening summary text.",
        metrics: { overallScore: 72, confidence: "medium" },
        created_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    citedModelRuns: [
      {
        id: "model-1",
        run_title: "AM assignment",
        engine_key: "aequilibrae",
        status: "succeeded",
        result_summary_json: { overallScore: 61 },
      },
    ],
    citedCountyRuns: [
      {
        id: "county-1",
        run_name: "County validation",
        stage: "validated-screening",
        validation_summary_json: { passed: 4, warned: 1, failed: 0 },
      },
    ],
    projectFundingSnapshot: buildProjectFundingSnapshot({
      profile: { funding_need_amount: 500000, local_match_need_amount: 50000, updated_at: null },
      awards: [{ awarded_amount: 200000, match_amount: 0, risk_flag: null, obligation_due_at: null, updated_at: null, created_at: null }],
      opportunities: [],
      invoices: [],
    }),
  };
}

describe("factsHash", () => {
  const facts: NarrativeFact[] = [
    { fact_id: "fact_1", claim_text: "The project has a $500,000 funding need." },
    { fact_id: "fact_2", claim_text: "One award record commits $200,000." },
  ];

  it("is stable across object key order", () => {
    const reordered: NarrativeFact[] = facts.map(
      // Same fields, opposite insertion order — hashing must not see key order.
      (fact) => JSON.parse(`{"claim_text": ${JSON.stringify(fact.claim_text)}, "fact_id": ${JSON.stringify(fact.fact_id)}}`)
    );
    expect(factsHash(reordered)).toBe(factsHash(facts));
  });

  it("is stable across fact-list order (ids are positional, claims are the content)", () => {
    const reversed = [...facts].reverse().map((fact, index) => ({
      fact_id: `fact_${index + 1}`,
      claim_text: fact.claim_text,
    }));
    expect(factsHash(reversed)).toBe(factsHash(facts));
  });

  it("changes when any claim value changes", () => {
    const changed = facts.map((fact) =>
      fact.fact_id === "fact_2"
        ? { ...fact, claim_text: "One award record commits $250,000." }
        : fact
    );
    expect(factsHash(changed)).not.toBe(factsHash(facts));
  });

  it("does not collapse adjacent claims into each other", () => {
    const joined = [{ fact_id: "fact_1", claim_text: "ab c" }];
    const split = [
      { fact_id: "fact_1", claim_text: "ab" },
      { fact_id: "fact_2", claim_text: "c" },
    ];
    expect(factsHash(joined)).not.toBe(factsHash(split));
  });
});

describe("buildReportSectionFacts", () => {
  it("states project posture, funding amounts, and attachment counts for status/executive sections", () => {
    for (const sectionKey of ["status_snapshot", "executive_summary"]) {
      const facts = buildReportSectionFacts(baseInput(), sectionKey);
      const claims = facts.map((fact) => fact.claim_text).join("\n");

      expect(claims).toContain('The Main St Bridge project is in status "Active"');
      expect(claims).toContain('delivery phase "Design"');
      expect(claims).toContain("Project summary on record: Replace the load-limited bridge.");
      expect(claims).toContain("Report summary on record: Quarterly packet for the board.");
      expect(claims).toContain(
        "1 analysis run(s), 1 cited worker model run(s), and 1 cited county validation run(s) are attached to this report."
      );
      // Real dollar values from the deterministic funding snapshot.
      expect(claims).toContain("$200,000 across 1 award record(s)");
      expect(claims).toContain("recorded funding need: $500,000");
      // Fact ids are sequential and unique.
      expect(facts.map((fact) => fact.fact_id)).toEqual(
        facts.map((_, index) => `fact_${index + 1}`)
      );
      // Summary sections never carry per-run modeling figures.
      expect(claims).not.toContain("AM assignment");
    }
  });

  it("states each attached run with its own recorded values for run_summaries", () => {
    const facts = buildReportSectionFacts(baseInput(), "run_summaries");
    const claims = facts.map((fact) => fact.claim_text).join("\n");

    expect(claims).toContain('Analysis run "Corridor screening"');
    expect(claims).toContain("overall score 72/100 and confidence Medium");
    expect(claims).toContain("Saved run summary: Screening summary text.");
    expect(claims).toContain('Worker model run "AM assignment"');
    expect(claims).toContain('has status "Succeeded"');
    expect(claims).toContain('County validation run "County validation"');
    expect(claims).toContain("4 pass, 1 warning, 0 fail");
  });

  it("carries the engine's standing screening caveat on every worker model run fact", () => {
    const facts = buildReportSectionFacts(baseInput(), "run_summaries");
    const modelFact = facts.find((fact) => fact.claim_text.includes("AM assignment"));
    expect(modelFact).toBeDefined();
    // The managed run-mode registry's caveatSummary rides inside the fact so a
    // sentence citing it inherits the honest framing.
    expect(modelFact?.claim_text).toMatch(/[Ss]creening/);
  });

  it("returns no facts for a section outside the AI-narrative surface", () => {
    expect(buildReportSectionFacts(baseInput(), "deliverables")).toEqual([]);
    expect(buildReportSectionFacts(baseInput(), "cover_page")).toEqual([]);
  });

  it("omits funding claims when no snapshot exists instead of fabricating zeros", () => {
    const input = { ...baseInput(), projectFundingSnapshot: null };
    const claims = buildReportSectionFacts(input, "status_snapshot").map((fact) => fact.claim_text);
    expect(claims.join("\n")).not.toContain("funding posture");
  });
});

describe("parseStoredDraft", () => {
  const storedRow = {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    target_kind: "report_section",
    target_id: "33333333-3333-4333-8333-333333333333",
    section_key: "executive_summary",
    draft_markdown: "Drafted text. [fact:fact_1]",
    model: "claude-opus-4-8",
    grounding_json: { mode: "annotated" },
    grounded_sentence_count: 1,
    total_sentence_count: 1,
    facts_hash: "abc123",
    status: "draft",
    accepted_markdown: null,
    accepted_by: null,
    accepted_at: null,
    created_by: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-07-27T00:00:00.000Z",
  };

  it("round-trips a well-formed row", () => {
    const parsed = parseStoredDraft(storedRow);
    expect(parsed).not.toBeNull();
    expect(parsed?.target_kind).toBe("report_section");
    expect(parsed?.section_key).toBe("executive_summary");
    expect(parsed?.status).toBe("draft");
    expect(parsed?.facts_hash).toBe("abc123");
  });

  it("parses an rtp_chapter row with a null section key", () => {
    const parsed = parseStoredDraft({ ...storedRow, target_kind: "rtp_chapter", section_key: null });
    expect(parsed?.target_kind).toBe("rtp_chapter");
    expect(parsed?.section_key).toBeNull();
  });

  it("rejects malformed rows instead of letting them break a panel", () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("row")).toBeNull();
    expect(parseStoredDraft({ ...storedRow, target_kind: "memo" })).toBeNull();
    expect(parseStoredDraft({ ...storedRow, status: "published" })).toBeNull();
    expect(parseStoredDraft({ ...storedRow, draft_markdown: 42 })).toBeNull();
    expect(parseStoredDraft({ ...storedRow, facts_hash: undefined })).toBeNull();
    expect(parseStoredDraft({ ...storedRow, grounded_sentence_count: "1" })).toBeNull();
  });
});
