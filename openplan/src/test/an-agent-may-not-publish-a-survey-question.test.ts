import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * THE ONE PROPERTY THE DRAFT STATE EXISTS FOR: an agent writes wording, and a
 * PERSON decides whether anybody is asked it.
 *
 * Nathaniel's decision of 2026-08-03 registers this action on exactly that
 * condition. The machine-translation accept and the campaign accessibility
 * contact are refused because approving them IS publishing them — consent and
 * publication are one event, so review has to fit in a dialog. This action is
 * allowed because they are two events: approving it puts a draft in the survey
 * builder, badged, invisible to the public, and a planner reads it there.
 *
 * If an agent can reach 'published', that argument collapses and the action
 * becomes the thing that was refused. So the property is asserted four ways —
 * at the route, at the request boundary, and in the two type surfaces — because
 * any one of them alone is a single point of failure.
 */

const SRC = path.join(process.cwd(), "src");

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "99999999-9999-4999-8999-999999999999";

let insertedRow: Record<string, unknown> | null = null;
let executionSource: "manual" | "planner_agent_quick_link" = "manual";

const insertMock = vi.fn((row: Record<string, unknown>) => {
  insertedRow = row;
  return {
    select: () => ({
      single: async () => ({ data: { id: "question-1", ...row }, error: null }),
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => ({
      insert: insertMock,
      select: () => {
        const link: Record<string, unknown> = {
          order: () => ({ order: async () => ({ data: [], error: null }) }),
        };
        link.eq = () => link;
        return link;
      },
    }),
  }),
  createServiceRoleClient: () => ({ from: () => ({ insert: () => ({}) }) }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: async () => ({
    campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, name: "Corridor listening" },
    allowed: true,
    error: null,
  }),
  validateCampaignCategoryAccess: async () => ({ category: { id: "cat-1" }, error: null }),
}));

/**
 * The approval seam is stubbed to SUCCEED, deliberately. This file is not about
 * whether approval works — `action-approval-server` has its own tests — it is
 * about what the route writes once approval has passed. Stubbing it to fail
 * would make every assertion below unreachable while still going green.
 */
vi.mock("@/lib/assistant/action-approval-server", () => ({
  readAssistantExecutionSource: () => executionSource,
  verifyAssistantActionApproval: async () => ({
    approvalId: "approval-1",
    inputHash: "hash",
    executionSource: "planner_agent_quick_link",
    authorship: { actorKind: "planner_agent", actorAgentId: "openplan.planner_agent" },
  }),
}));

vi.mock("@/lib/observability/action-audit", () => ({
  assistantActionAuditIdentity: () => ({}),
  withAssistantActionAudit: async (
    _client: unknown,
    _input: unknown,
    effect: () => Promise<unknown>
  ) => effect(),
}));

import { POST } from "@/app/api/engagement/campaigns/[campaignId]/survey/questions/route";

function request(body: Record<string, unknown>) {
  return new Request(`https://openplan.test/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

async function post(body: Record<string, unknown>) {
  const response = await POST(request(body), { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  insertedRow = null;
  executionSource = "manual";
  vi.clearAllMocks();
});

describe("what the route writes", () => {
  it("writes a DRAFT when the request came through the agent seam", async () => {
    executionSource = "planner_agent_quick_link";

    const { status } = await post({
      questionType: "free_text",
      prompt: "What would you change about how you get around this area?",
    });

    expect(status).toBe(201);
    expect(insertedRow?.status).toBe("draft");
  });

  it("writes a PUBLISHED question when a person uses the builder", async () => {
    executionSource = "manual";

    await post({ questionType: "free_text", prompt: "What would you change?" });

    // A planner's own question behaves exactly as it always has. The draft state
    // constrains the agent, not the product.
    expect(insertedRow?.status).toBe("published");
  });
});

describe("what the route refuses", () => {
  it("refuses an agent request that names a status at all", async () => {
    executionSource = "planner_agent_quick_link";

    const { status, body } = await post({
      questionType: "free_text",
      prompt: "What would you change?",
      status: "published",
    });

    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/outside its own payload/i);
    expect(String(body.details)).toContain("status");
    expect(insertedRow, "nothing may be written when the scope check refuses").toBeNull();
  });

  it("refuses an agent request that decides how the question is asked", async () => {
    executionSource = "planner_agent_quick_link";

    for (const extra of [
      { required: true },
      { sortOrder: 0 },
      { categoryId: "33333333-3333-4333-8333-333333333333" },
      { config: { condition: { questionId: "x", operator: "equals", value: "y" } } },
    ]) {
      insertedRow = null;
      const { status, body } = await post({
        questionType: "free_text",
        prompt: "What would you change?",
        ...extra,
      });

      expect(status, JSON.stringify(extra)).toBe(400);
      expect(String(body.details)).toContain(Object.keys(extra)[0]);
      expect(insertedRow).toBeNull();
    }
  });

  it("lets a PERSON send all of those, because the endpoint is theirs", async () => {
    executionSource = "manual";

    const { status } = await post({
      questionType: "free_text",
      prompt: "What would you change?",
      required: true,
      sortOrder: 3,
    });

    expect(status).toBe(201);
    expect(insertedRow?.required).toBe(true);
    expect(insertedRow?.sort_order).toBe(3);
  });
});

describe("the type surfaces carry no way to say it", () => {
  it("keeps `status` off the action's union variant and its approval schema", () => {
    // Structural, because the two runtime refusals above both depend on the
    // request being recognised as agent-sourced — a header the client sets. The
    // absence of the field is what makes the dangerous value unspeakable even
    // to code that never reaches those checks.
    const catalog = readFileSync(path.join(SRC, "lib", "assistant", "catalog.ts"), "utf8");
    const variant = catalog.slice(catalog.indexOf('kind: "create_survey_question_draft"'));
    const variantBody = variant.slice(0, variant.indexOf("};"));
    expect(variantBody).not.toMatch(/^\s*status\??:/m);

    const schema = readFileSync(
      path.join(SRC, "lib", "assistant", "action-approval-server.ts"),
      "utf8"
    );
    const branch = schema.slice(schema.indexOf('z.literal("create_survey_question_draft")'));
    const branchBody = branch.slice(0, branch.indexOf("}),"));
    expect(branchBody).not.toMatch(/\bstatus:/);
  });

  it("keeps the draft literal in the route, where nothing can pass a value into it", () => {
    const route = readFileSync(
      path.join(
        SRC,
        "app",
        "api",
        "engagement",
        "campaigns",
        "[campaignId]",
        "survey",
        "questions",
        "route.ts"
      ),
      "utf8"
    );
    // The literal, not a read: `parsed.data.status` or `body.status` reaching
    // this decision would be an agent able to publish by asking.
    expect(route).toMatch(/const status = agentSourced \? "draft" : "published";/);
    expect(route).not.toMatch(/parsed\.data\.status/);
  });
});
