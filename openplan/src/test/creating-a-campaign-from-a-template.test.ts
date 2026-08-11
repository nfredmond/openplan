import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAMPAIGN_TEMPLATES, getCampaignTemplate } from "@/lib/engagement/campaign-templates";

/**
 * Creating a campaign from a template yields the campaign PLUS the template's
 * starter categories and survey questions — with every question a DRAFT — and
 * blank creation stays exactly what it was.
 *
 * Every expectation here is DERIVED from the registry entry under test, and the
 * suite runs the same assertions against two different templates: a helper that
 * hardcoded one template's contents would satisfy one binding and fail the
 * other.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";

const insertsByTable = new Map<string, Record<string, unknown>[]>();

function recordedInserts(table: string): Record<string, unknown>[] {
  return insertsByTable.get(table) ?? [];
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        const rows = insertsByTable.get(table) ?? [];
        rows.push(row);
        insertsByTable.set(table, rows);
        const id = `${table}-${rows.length}`;
        return {
          select: () => ({ single: async () => ({ data: { id, ...row }, error: null }) }),
        };
      },
    }),
  }),
  createServiceRoleClient: () => {
    throw new Error("the campaign create route must not use the service role");
  },
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    workspace: null,
  }),
}));

vi.mock("@/lib/engagement/api", () => ({
  loadProjectAccess: async () => {
    throw new Error("no test here sends a projectId");
  },
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/engagement/campaigns/route";

async function post(body: Record<string, unknown>) {
  const request = new Request("https://openplan.test/api/engagement/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
  const response = await POST(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  insertsByTable.clear();
  vi.clearAllMocks();
});

// Two templates with different shapes, so the binding is varied: one carries a
// map question and choice options, the other is the meeting-intake shape.
const TEMPLATE_BINDINGS = ["corridor-safety-study", "project-open-house"] as const;

describe.each(TEMPLATE_BINDINGS)("creating from the %s template", (templateId) => {
  const template = getCampaignTemplate(templateId)!;

  it("creates the campaign, the template's categories, and its questions as drafts", async () => {
    const { status, body } = await post({ title: "Template-created campaign", templateId });

    expect(status).toBe(201);
    expect(body.campaignId).toBe("engagement_campaigns-1");
    expect(body.template).toMatchObject({
      id: template.id,
      applied: true,
      categoriesCreated: template.categories.length,
      questionsCreated: template.questions.length,
      optionsCreated: template.questions.reduce((sum, q) => sum + (q.options?.length ?? 0), 0),
    });

    // The campaign row carries the template's type and resident-facing text.
    const [campaignRow] = recordedInserts("engagement_campaigns");
    expect(campaignRow.engagement_type).toBe(template.engagementType);
    expect(campaignRow.public_description).toBe(template.suggestedPublicDescription);
    expect(campaignRow.summary).toBe(template.suggestedSummary);
    expect(campaignRow.status).toBe("draft");

    // Categories: this template's own labels, in its own order.
    const categoryRows = recordedInserts("engagement_categories");
    expect(categoryRows.map((row) => row.label)).toEqual(template.categories.map((c) => c.label));
    for (const row of categoryRows) {
      expect(row.campaign_id).toBe("engagement_campaigns-1");
      expect(row.created_by).toBe(USER_ID);
      expect(typeof row.slug).toBe("string");
    }

    // Questions: this template's own prompts — and EVERY one is a draft.
    const questionRows = recordedInserts("engagement_survey_questions");
    expect(questionRows.map((row) => row.prompt)).toEqual(template.questions.map((q) => q.prompt));
    for (const row of questionRows) {
      expect(row.status, String(row.prompt)).toBe("draft");
      expect(row.campaign_id).toBe("engagement_campaigns-1");
    }
    expect(questionRows.some((row) => row.status === "published")).toBe(false);

    // Options land against the questions that declared them.
    const optionRows = recordedInserts("engagement_survey_question_options");
    const expectedOptionLabels = template.questions.flatMap((q) => (q.options ?? []).map((o) => o.label));
    expect(optionRows.map((row) => row.label)).toEqual(expectedOptionLabels);
    for (const row of optionRows) {
      expect(String(row.question_id)).toMatch(/^engagement_survey_questions-\d+$/);
      expect(row.campaign_id).toBe("engagement_campaigns-1");
    }
  });

  it("keeps the planner's own summary when they typed one", async () => {
    await post({ title: "Custom summary wins", templateId, summary: "What the planner wrote." });
    const [campaignRow] = recordedInserts("engagement_campaigns");
    expect(campaignRow.summary).toBe("What the planner wrote.");
  });
});

describe("the two bindings actually differ", () => {
  it("the templates under test do not share contents, so a hardcoded apply cannot pass both", () => {
    const [a, b] = TEMPLATE_BINDINGS.map((id) => getCampaignTemplate(id)!);
    expect(a.questions.map((q) => q.prompt)).not.toEqual(b.questions.map((q) => q.prompt));
    expect(a.categories.map((c) => c.label)).not.toEqual(b.categories.map((c) => c.label));
  });
});

describe("blank creation is unchanged", () => {
  it("creates only the campaign — no categories, questions, or options — and reports no template", async () => {
    const { status, body } = await post({ title: "Blank campaign" });

    expect(status).toBe(201);
    expect(body.template).toBeUndefined();
    expect(recordedInserts("engagement_campaigns")).toHaveLength(1);
    expect(recordedInserts("engagement_categories")).toHaveLength(0);
    expect(recordedInserts("engagement_survey_questions")).toHaveLength(0);
    expect(recordedInserts("engagement_survey_question_options")).toHaveLength(0);

    const [campaignRow] = recordedInserts("engagement_campaigns");
    expect(campaignRow.public_description).toBeUndefined();
    expect(campaignRow.summary).toBeNull();
  });
});

describe("an unknown template refuses before anything is written", () => {
  it("answers 400 and inserts nothing", async () => {
    const { status, body } = await post({ title: "Nope", templateId: "no-such-template" });

    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/unknown campaign template/i);
    expect(insertsByTable.size).toBe(0);
  });
});

describe("every registered template applies cleanly end to end", () => {
  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id] as const))("%s", async (templateId) => {
    const { status, body } = await post({ title: `From ${templateId}`, templateId });
    expect(status).toBe(201);
    expect((body.template as Record<string, unknown>).applied).toBe(true);
  });
});
