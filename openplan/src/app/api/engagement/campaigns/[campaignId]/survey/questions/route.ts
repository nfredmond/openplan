import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  readAssistantExecutionSource,
  verifyAssistantActionApproval,
  type AssistantApprovalVerification,
} from "@/lib/assistant/action-approval-server";
import { assistantActionAuditIdentity, withAssistantActionAudit } from "@/lib/observability/action-audit";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { USER_AUTHORED } from "@/lib/assistant/agent-principal";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { loadSurveyConditionRefs, loadSurveyDefinition } from "@/lib/engagement/survey-responses";
import {
  isSurveyQuestionType,
  validateSurveyConditionGraph,
  validateSurveyConfig,
  type SurveyConditionQuestionRef,
  type SurveyQuestionType,
} from "@/lib/engagement/survey";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const createQuestionSchema = z.object({
  questionType: z.string().refine((v): v is SurveyQuestionType => isSurveyQuestionType(v), "Unknown question type"),
  prompt: z.string().trim().min(1).max(2000),
  helpText: z.string().trim().max(2000).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  categoryId: z.string().uuid().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

type RouteContext = { params: Promise<{ campaignId: string }> };

const QUESTION_SELECT =
  "id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, status, sort_order, config_json, created_at, updated_at";

/**
 * Exactly the body keys the `create_survey_question_draft` action maps onto this
 * endpoint.
 *
 * The endpoint is WIDER than the action — it also takes `required`, `sortOrder`,
 * `categoryId` and `config` — and the approval hash covers the action the route
 * rebuilds, not the request body. So a request carrying the three keys the
 * planner approved PLUS a `config` holding a condition would hash identically to
 * what they saw and write the condition too. That is the third rule the agentic
 * seam is built on, and this is where it is enforced.
 *
 * `status` is not in this list and never should be: an agent may not name it,
 * and the literal below is what decides it.
 */
const AGENT_DRAFT_BODY_KEYS = ["questionType", "prompt", "helpText"];

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const { questions, optionsByQuestion } = await loadSurveyDefinition(supabase, access.campaign.id);
    return NextResponse.json({
      questions: questions.map((q) => ({ ...q, options: optionsByQuestion.get(q.id) ?? [] })),
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing survey questions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.create", request);
  const startedAt = Date.now();
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createQuestionSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid survey question payload", issues: parsed.error.issues }, { status: 400 });
    }

    /**
     * Whether this came through the Planner Agent seam, and whether it stayed
     * inside what an agent may write. Checked BEFORE any database work, because
     * it is a refusal about the request rather than about the campaign — and
     * against the RAW body, because zod has already stripped unknown keys from
     * `parsed.data` and a scope check over the stripped object would approve
     * everything it was written to catch.
     */
    const executionSource = readAssistantExecutionSource(request);
    const agentSourced = executionSource === "planner_agent_quick_link";
    const scopeRefusal = refuseOutOfScopeAgentRequest({
      executionSource,
      body: payloadBody.data,
      allowedKeys: AGENT_DRAFT_BODY_KEYS,
      actionKind: "create_survey_question_draft",
    });
    if (scopeRefusal) {
      audit.warn("agent_request_out_of_scope", {
        campaignId: routeParams.data.campaignId,
        rejectedKeys: scopeRefusal.rejectedKeys,
      });
      return NextResponse.json(
        { error: scopeRefusal.error, details: scopeRefusal.details },
        { status: 400 }
      );
    }

    // Type-specific config validation (likert scale, budget total, etc.).
    const configResult = validateSurveyConfig(parsed.data.questionType, parsed.data.config ?? {});
    if (!configResult.ok) {
      return NextResponse.json({ error: `Invalid question configuration: ${configResult.message}` }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    if (parsed.data.categoryId) {
      const categoryAccess = await validateCampaignCategoryAccess(supabase, access.campaign.id, parsed.data.categoryId);
      if (categoryAccess.error || !categoryAccess.category) {
        return NextResponse.json({ error: "Category does not belong to this campaign" }, { status: 400 });
      }
    }

    /**
     * A CONDITIONAL QUESTION IS CHECKED AGAINST THE SURVEY IT WOULD CREATE, not
     * against the one that exists.
     *
     * `validateSurveyConfig` above can only see this question's own JSON; whether
     * the question it points at exists, comes earlier, and can be compared that
     * way is a fact about the whole survey. So the candidate is spliced into the
     * existing display order at the position its `sortOrder` gives it — ties
     * after the questions already there, which is where `created_at ASC` will
     * put it — and the resulting survey is validated as a whole.
     */
    const sortOrder = parsed.data.sortOrder ?? 0;
    const candidate: SurveyConditionQuestionRef & { sortOrder: number } = {
      id: "__new_question__",
      prompt: parsed.data.prompt,
      question_type: parsed.data.questionType,
      config: configResult.config,
      optionIds: [],
      sortOrder,
    };
    const existingRefs = await loadSurveyConditionRefs(supabase, access.campaign.id);
    const proposed = [...existingRefs, candidate].sort((left, right) =>
      left.sortOrder === right.sortOrder
        ? (left.id === "__new_question__" ? 1 : right.id === "__new_question__" ? -1 : 0)
        : left.sortOrder - right.sortOrder
    );
    // Only problems this write INTRODUCES are refused. A survey already carrying
    // a broken condition (a question archived out from under one, say) must not
    // block an unrelated addition — the operator would be stuck with no way to
    // reach the fix.
    const existingProblems = new Set(
      validateSurveyConditionGraph(existingRefs).map((problem) => `${problem.code}:${problem.questionId}`)
    );
    const conditionProblems = validateSurveyConditionGraph(proposed).filter(
      (problem) => !existingProblems.has(`${problem.code}:${problem.questionId}`)
    );
    if (conditionProblems.length > 0) {
      return NextResponse.json(
        { error: conditionProblems[0].message, code: conditionProblems[0].code },
        { status: 400 }
      );
    }

    /**
     * Approval evidence, verified against the action this route rebuilds from
     * its OWN parsed data — so an approval minted for one question's wording
     * cannot execute a different one.
     *
     * `workspaceId` comes off the campaign row rather than the request. That is
     * deliberately stronger than reading it from the body: the value the planner
     * approved has to equal the workspace the campaign actually belongs to, or
     * the hash will not match and this answers 403.
     */
    const serviceSupabase = agentSourced ? createServiceRoleClient() : null;
    let approval: AssistantApprovalVerification = {
      approvalId: null,
      inputHash: null,
      executionSource: "manual",
      authorship: USER_AUTHORED,
    };

    if (agentSourced && serviceSupabase) {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase,
          userId: user.id,
          workspaceId: access.campaign.workspace_id,
          action: {
            kind: "create_survey_question_draft",
            workspaceId: access.campaign.workspace_id,
            campaignId: access.campaign.id,
            questionType: parsed.data.questionType,
            prompt: parsed.data.prompt,
            ...(parsed.data.helpText?.trim() ? { helpText: parsed.data.helpText.trim() } : {}),
          },
        });
      } catch (approvalError) {
        audit.warn("agent_approval_rejected", { campaignId: access.campaign.id });
        return NextResponse.json(
          { error: approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed" },
          { status: 403 }
        );
      }
    }

    /**
     * AN AGENT'S QUESTION IS NEVER ASKED OF ANYBODY UNTIL A PERSON SAYS SO.
     *
     * The literal is written here rather than read from anywhere. There is no
     * `status` field on the action, none in the request schema, and none in the
     * agent's allowed body keys — so this is the only expression in the system
     * that decides it, and it can only produce 'draft' on the agent path.
     *
     * A person using the survey builder keeps the behaviour they have always
     * had: what they write is what the survey asks. They are the ones
     * accountable for it.
     */
    const status = agentSourced ? "draft" : "published";

    const insertQuestion = async () =>
      await supabase
        .from("engagement_survey_questions")
        .insert({
          campaign_id: access.campaign.id,
          category_id: parsed.data.categoryId ?? null,
          question_type: parsed.data.questionType,
          prompt: parsed.data.prompt,
          help_text: parsed.data.helpText?.trim() || null,
          required: parsed.data.required ?? false,
          sort_order: parsed.data.sortOrder ?? 0,
          config_json: configResult.config,
          status,
          created_by: user.id,
        })
        .select(QUESTION_SELECT)
        .single();

    const { data: question, error: insertError } =
      agentSourced && serviceSupabase
        ? await withAssistantActionAudit(
            serviceSupabase,
            {
              actionKind: "create_survey_question_draft",
              workspaceId: access.campaign.workspace_id,
              userId: user.id,
              ...assistantActionAuditIdentity(approval),
              inputSummary: {
                campaignId: access.campaign.id,
                questionType: parsed.data.questionType,
                // The wording itself, not a length: the ledger is where somebody
                // reviewing what the agent wrote goes to read it.
                prompt: parsed.data.prompt,
                status,
              },
            },
            insertQuestion
          )
        : await insertQuestion();

    if (insertError || !question) {
      audit.error("question_insert_failed", { campaignId: access.campaign.id, message: insertError?.message ?? "unknown", code: insertError?.code ?? null });
      return NextResponse.json({ error: "Failed to create survey question" }, { status: 500 });
    }

    audit.info("question_created", { userId: user.id, campaignId: access.campaign.id, questionId: question.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ questionId: question.id, question }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while creating survey question" }, { status: 500 });
  }
}
