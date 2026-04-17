import { describe, expect, it, vi } from "vitest";

import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";

type ProjectFundingProfileRow = {
  funding_need_amount: number | string | null;
  local_match_need_amount: number | string | null;
  updated_at: string | null;
};

type FundingAwardRow = {
  awarded_amount: number | string;
  match_amount: number | string;
  risk_flag: string;
  obligation_due_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type FundingOpportunityRow = {
  expected_award_amount: number | string | null;
  decision_state: string;
  opportunity_status: string;
  closes_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type BillingInvoiceRow = {
  status: string;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  due_date: string | null;
  invoice_date: string | null;
  created_at: string | null;
};

type CapturedUpdate = {
  values?: {
    rtp_posture: unknown;
    rtp_posture_updated_at: string;
  };
  where: Array<[string, string]>;
};

function buildSupabase({
  profile,
  awards,
  opportunities,
  invoices,
  profileError,
  awardsError,
  updateError,
}: {
  profile: ProjectFundingProfileRow | null;
  awards: FundingAwardRow[];
  opportunities?: FundingOpportunityRow[];
  invoices?: BillingInvoiceRow[];
  profileError?: { message: string; code?: string };
  awardsError?: { message: string; code?: string };
  updateError?: { message: string; code?: string };
}) {
  const capturedUpdate: CapturedUpdate = { values: undefined, where: [] };

  const from = vi.fn((table: string) => {
    if (table === "project_funding_profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: profile,
              error: profileError ?? null,
            })),
          })),
        })),
      };
    }

    if (table === "funding_awards") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: awards,
              error: awardsError ?? null,
            })),
          })),
        })),
      };
    }

    if (table === "funding_opportunities") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: opportunities ?? [],
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "billing_invoice_records") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: invoices ?? [],
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "projects") {
      return {
        update: vi.fn((values: CapturedUpdate["values"]) => {
          capturedUpdate.values = values;
          return {
            eq: vi.fn((col1: string, val1: string) => {
              capturedUpdate.where.push([col1, val1]);
              return {
                eq: vi.fn(async (col2: string, val2: string) => {
                  capturedUpdate.where.push([col2, val2]);
                  return { error: updateError ?? null };
                }),
              };
            }),
          };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as Parameters<typeof rebuildProjectRtpPosture>[0]["supabase"],
    capturedUpdate,
  };
}

describe("rebuildProjectRtpPosture", () => {
  it("marks a project funded when committed awards meet the funding need", async () => {
    const { supabase, capturedUpdate } = buildSupabase({
      profile: {
        funding_need_amount: 1_000_000,
        local_match_need_amount: 100_000,
        updated_at: "2026-04-10T00:00:00Z",
      },
      awards: [
        {
          awarded_amount: 1_250_000,
          match_amount: 150_000,
          risk_flag: "none",
          obligation_due_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-04-15T00:00:00Z",
          created_at: "2026-04-15T00:00:00Z",
        },
      ],
    });

    const now = new Date("2026-04-16T14:30:00.000Z");
    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => now,
    });

    expect(result.error).toBeNull();
    expect(result.posture?.status).toBe("funded");
    expect(result.posture?.pipelineStatus).toBe("funded");
    expect(result.posture?.committedFundingAmount).toBe(1_250_000);
    expect(result.posture?.fundingNeedAmount).toBe(1_000_000);
    expect(result.posture?.remainingFundingGap).toBe(0);
    expect(result.updatedAt).toBe("2026-04-16T14:30:00.000Z");
    expect(capturedUpdate.values?.rtp_posture).toMatchObject({
      status: "funded",
      committedFundingAmount: 1_250_000,
    });
    expect(capturedUpdate.where).toEqual([
      ["id", "project-1"],
      ["workspace_id", "workspace-1"],
    ]);
  });

  it("marks a project partially funded when committed awards cover part of the need", async () => {
    const { supabase, capturedUpdate } = buildSupabase({
      profile: {
        funding_need_amount: 1_000_000,
        local_match_need_amount: 100_000,
        updated_at: "2026-04-10T00:00:00Z",
      },
      awards: [
        {
          awarded_amount: 400_000,
          match_amount: 40_000,
          risk_flag: "watch",
          obligation_due_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-04-15T00:00:00Z",
          created_at: "2026-04-15T00:00:00Z",
        },
      ],
    });

    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => new Date("2026-04-16T00:00:00.000Z"),
    });

    expect(result.error).toBeNull();
    expect(result.posture?.status).toBe("partially_funded");
    expect(result.posture?.awardRiskCount).toBe(1);
    expect(capturedUpdate.values?.rtp_posture).toMatchObject({
      status: "partially_funded",
      awardCount: 1,
    });
  });

  it("marks a project unfunded when no awards exist for a known need", async () => {
    const { supabase, capturedUpdate } = buildSupabase({
      profile: {
        funding_need_amount: 500_000,
        local_match_need_amount: 0,
        updated_at: "2026-04-10T00:00:00Z",
      },
      awards: [],
    });

    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => new Date("2026-04-16T00:00:00.000Z"),
    });

    expect(result.error).toBeNull();
    expect(result.posture?.status).toBe("unfunded");
    expect(result.posture?.pipelineStatus).toBe("unfunded");
    expect(capturedUpdate.values?.rtp_posture).toMatchObject({
      status: "unfunded",
      awardCount: 0,
    });
  });

  it("credits pursued opportunities in the pipeline status", async () => {
    const { supabase } = buildSupabase({
      profile: {
        funding_need_amount: 1_000_000,
        local_match_need_amount: 0,
        updated_at: "2026-04-10T00:00:00Z",
      },
      awards: [],
      opportunities: [
        {
          expected_award_amount: 1_200_000,
          decision_state: "pursue",
          opportunity_status: "open",
          closes_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-04-14T00:00:00Z",
          created_at: "2026-04-14T00:00:00Z",
        },
      ],
    });

    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => new Date("2026-04-16T00:00:00.000Z"),
    });

    expect(result.error).toBeNull();
    expect(result.posture?.status).toBe("unfunded");
    expect(result.posture?.pipelineStatus).toBe("likely_covered");
    expect(result.posture?.pursuedOpportunityCount).toBe(1);
  });

  it("surfaces the update error when the projects write fails", async () => {
    const { supabase } = buildSupabase({
      profile: {
        funding_need_amount: 500_000,
        local_match_need_amount: 0,
        updated_at: null,
      },
      awards: [
        {
          awarded_amount: 500_000,
          match_amount: 0,
          risk_flag: "none",
          obligation_due_at: null,
          updated_at: null,
          created_at: null,
        },
      ],
      updateError: { message: "permission denied", code: "42501" },
    });

    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
    });

    expect(result.error).toEqual({ message: "permission denied", code: "42501" });
    expect(result.posture).not.toBeNull();
    expect(result.updatedAt).toBeNull();
  });

  it("returns early with an error when the profile read fails", async () => {
    const { supabase } = buildSupabase({
      profile: null,
      awards: [],
      profileError: { message: "profile read failed" },
    });

    const result = await rebuildProjectRtpPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
    });

    expect(result.error?.message).toBe("profile read failed");
    expect(result.posture).toBeNull();
    expect(result.updatedAt).toBeNull();
  });
});
