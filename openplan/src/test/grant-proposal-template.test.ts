import { describe, expect, it, vi } from "vitest";

import {
  PROPOSAL_SECTION_TEMPLATE,
  buildProposalSectionSeeds,
} from "@/lib/grants/proposal-template";
import {
  loadOpportunityPursuitContext,
  looksLikePendingPursuitSchema,
  parsePursuitKind,
} from "@/lib/grants/pursuit";

describe("PROPOSAL_SECTION_TEMPLATE", () => {
  it("defines the five proposal sections with unique keys, in submission order", () => {
    expect(PROPOSAL_SECTION_TEMPLATE.map((template) => template.key)).toEqual([
      "approach",
      "team_qualifications",
      "past_performance",
      "schedule",
      "fee_placeholder",
    ]);
    expect(new Set(PROPOSAL_SECTION_TEMPLATE.map((template) => template.key)).size).toBe(
      PROPOSAL_SECTION_TEMPLATE.length
    );
  });

  it("grounds team qualifications on Knowledge Base documents ONLY, and says so", () => {
    const team = PROPOSAL_SECTION_TEMPLATE.find((template) => template.key === "team_qualifications")!;
    expect(team.suggestedEvidence).toEqual(["kb"]);
    expect(team.guidance).toMatch(/never drafted from model memory/i);
    expect(team.guidance).toMatch(/uploaded/i);
  });

  it("draws past performance from completed projects and uploaded documents", () => {
    const pastPerformance = PROPOSAL_SECTION_TEMPLATE.find(
      (template) => template.key === "past_performance"
    )!;
    expect(pastPerformance.suggestedEvidence).toEqual(["project", "kb"]);
  });

  it("keeps the schedule section on project stage/delivery data, qualitative when absent", () => {
    const schedule = PROPOSAL_SECTION_TEMPLATE.find((template) => template.key === "schedule")!;
    expect(schedule.suggestedEvidence).toEqual(["project"]);
    expect(schedule.guidance).toMatch(/qualitative/i);
    expect(schedule.guidance).toMatch(/never invent dates/i);
  });

  it("pins the fee section as never AI-drafted", () => {
    const fee = PROPOSAL_SECTION_TEMPLATE.find((template) => template.key === "fee_placeholder")!;
    expect(fee.aiDraftingEnabled).toBe(false);
  });

  it("phrases every guidance line as verify-the-current-solicitation, naming no funder", () => {
    for (const template of PROPOSAL_SECTION_TEMPLATE) {
      expect(template.guidance).toMatch(/current solicitation/i);
    }
  });

  it("builds seeds that carry the template pins onto the rows", () => {
    const seeds = buildProposalSectionSeeds();
    expect(seeds).toHaveLength(PROPOSAL_SECTION_TEMPLATE.length);
    seeds.forEach((seed, index) => {
      expect(seed.source).toBe("catalog");
      expect(seed.sort_order).toBe(index);
    });
    expect(seeds.find((seed) => seed.section_key === "fee_placeholder")?.ai_drafting_enabled).toBe(
      false
    );
    expect(seeds.find((seed) => seed.section_key === "approach")?.ai_drafting_enabled).toBe(true);
    expect(seeds.find((seed) => seed.section_key === "team_qualifications")?.suggested_evidence).toEqual(
      ["kb"]
    );
  });
});

describe("pursuit context", () => {
  it("parses only the known kinds, defaulting everything else to grant", () => {
    expect(parsePursuitKind("proposal")).toBe("proposal");
    expect(parsePursuitKind("grant")).toBe("grant");
    expect(parsePursuitKind("rfp")).toBe("grant");
    expect(parsePursuitKind(null)).toBe("grant");
  });

  it("recognises the pending-schema shapes", () => {
    expect(looksLikePendingPursuitSchema('column "pursuit_kind" does not exist')).toBe(true);
    expect(
      looksLikePendingPursuitSchema(
        "Could not find the 'pursuit_kind' column of 'funding_opportunities' in the schema cache"
      )
    ).toBe(true);
    expect(looksLikePendingPursuitSchema("permission denied")).toBe(false);
  });

  function clientReturning(result: { data: unknown; error: { message: string } | null }) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: async () => result })),
        })),
      })),
    };
  }

  it("loads a proposal's solicitation context", async () => {
    const { context, error } = await loadOpportunityPursuitContext(
      clientReturning({
        data: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          pursuit_kind: "proposal",
          solicitation_number: "RFP-2026-014",
          submission_format_note: "Portal upload, 20-page limit.",
          questions_due_at: "2026-08-15T00:00:00.000Z",
        },
        error: null,
      }),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );

    expect(error).toBeNull();
    expect(context).toEqual({
      pursuitKind: "proposal",
      solicitationNumber: "RFP-2026-014",
      submissionFormatNote: "Portal upload, 20-page limit.",
      questionsDueAt: "2026-08-15T00:00:00.000Z",
      schemaPending: false,
    });
  });

  it("resolves a pending pursuit schema to the grant defaults, disclosed", async () => {
    const { context, error } = await loadOpportunityPursuitContext(
      clientReturning({
        data: null,
        error: { message: 'column "pursuit_kind" does not exist' },
      }),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );

    expect(error).toBeNull();
    expect(context.pursuitKind).toBe("grant");
    expect(context.schemaPending).toBe(true);
  });

  it("returns other read failures as errors — a proposal never silently degrades to a grant", async () => {
    const { error } = await loadOpportunityPursuitContext(
      clientReturning({ data: null, error: { message: "connection reset" } }),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );

    expect(error).toEqual({ message: "connection reset" });
  });
});
