import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildProposalSectionSeeds } from "@/lib/grants/proposal-template";

/**
 * Dedicated guard: the AI NEVER drafts a proposal's fee/cost content.
 *
 * The proposal template pins `fee_placeholder` with aiDraftingEnabled: false;
 * the seeded row carries that pin, and the drafting route's 422 refusal
 * enforces it server-side with no override. This test proves the whole chain:
 * a section row built EXACTLY as proposal seeding builds it is refused by the
 * real route before any model call, spend metering, or evidence assembly.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const generateTextMock = vi.fn();
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-anthropic-model"),
  createAnthropic: () => () => "mock-anthropic-model",
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimitMock(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEventMock(...args),
}));

import { POST as postSectionDraft } from "@/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft/route";

describe("proposal fee section drafting guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
        program_id: null,
        project_id: null,
        title: "On-call planning services RFP response",
        opportunity_status: "open",
        decision_state: "pursue",
      },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to draft the fee section a proposal seeds, before any model call", async () => {
    // The row exactly as proposal initialization inserts it — the pin comes
    // from the TEMPLATE, not from test fixture hand-tuning.
    const feeSeed = buildProposalSectionSeeds().find(
      (seed) => seed.section_key === "fee_placeholder"
    )!;
    expect(feeSeed.ai_drafting_enabled).toBe(false);

    const feeSectionRow = {
      id: SECTION_ID,
      workspace_id: WORKSPACE_ID,
      opportunity_id: OPPORTUNITY_ID,
      status: "not_started",
      final_markdown: null,
      finalized_from_draft_id: null,
      updated_by: null,
      created_at: "2026-07-27T00:00:00.000Z",
      updated_at: "2026-07-27T00:00:00.000Z",
      ...feeSeed,
    };

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_opportunity_application_sections") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({ maybeSingle: async () => ({ data: feeSectionRow, error: null }) })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const response = await postSectionDraft(
      new NextRequest(
        `http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}/draft`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      ),
      { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID, sectionId: SECTION_ID }) }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("section_not_ai_draftable");
    expect(body.message).toMatch(/never AI-drafted/i);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(recordAiUsageEventMock).not.toHaveBeenCalled();
  });
});
