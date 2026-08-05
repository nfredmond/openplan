import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import {
  findSurveyQuestionsDependingOn,
  validateSurveyConditionGraph,
  validateSurveyConfig,
  type SurveyConditionQuestionRef,
  type SurveyQuestionType,
} from "@/lib/engagement/survey";
import { loadSurveyConditionRefs } from "@/lib/engagement/survey-responses";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ campaignId: z.string().uuid(), questionId: z.string().uuid() });

// question_type is intentionally immutable — changing it would invalidate stored
// answers. Archive via isActive=false (keeps response history) instead of delete.
const patchQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000).optional(),
    helpText: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "No fields to update" });

type RouteContext = { params: Promise<{ campaignId: string; questionId: string }> };

const QUESTION_SELECT =
  "id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, sort_order, config_json, created_at, updated_at";

async function authorize(request: NextRequest, campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.write");
  if (access.error) return { response: NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 }) };
  if (!access.campaign) return { response: NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 }) };
  if (!access.allowed) return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  return { supabase, user, campaign: access.campaign };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.update", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchQuestionSchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid survey question update", issues: parsed.error.issues }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    // "Not found" is a fact about this campaign's survey, so only a read that
    // succeeded may say it — the same check `authorize` already makes on the
    // campaign one call above.
    const existingResult = await supabase
      .from("engagement_survey_questions")
      .select("id, question_type, prompt, sort_order, config_json")
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id)
      .maybeSingle();

    const existingFailure = classifyRouteReadFailure("survey question", existingResult);
    if (existingFailure) {
      audit.error("question_read_failed", {
        campaignId: campaign.id,
        questionId: routeParams.data.questionId,
        message: existingFailure.message,
      });
      return NextResponse.json(existingFailure.body, { status: existingFailure.status });
    }

    const existing = existingResult.data;
    if (!existing) return NextResponse.json({ error: "Survey question not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (parsed.data.prompt !== undefined) updates.prompt = parsed.data.prompt;
    if (parsed.data.helpText !== undefined) updates.help_text = parsed.data.helpText?.trim() || null;
    if (parsed.data.required !== undefined) updates.required = parsed.data.required;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.isActive !== undefined) updates.is_active = parsed.data.isActive;
    if (parsed.data.categoryId !== undefined) {
      if (parsed.data.categoryId) {
        const categoryAccess = await validateCampaignCategoryAccess(supabase, campaign.id, parsed.data.categoryId);
        if (categoryAccess.error || !categoryAccess.category) {
          return NextResponse.json({ error: "Category does not belong to this campaign" }, { status: 400 });
        }
      }
      updates.category_id = parsed.data.categoryId;
    }
    if (parsed.data.config !== undefined) {
      const configResult = validateSurveyConfig(existing.question_type as SurveyQuestionType, parsed.data.config);
      if (!configResult.ok) return NextResponse.json({ error: `Invalid question configuration: ${configResult.message}` }, { status: 400 });
      updates.config_json = configResult.config;
    }

    /**
     * CONDITIONS ARE RE-CHECKED ON EVERY EDIT THAT CAN BREAK THEM, and that is
     * three different edits, not one:
     *
     *   • the CONDITION itself changing, obviously;
     *   • the SORT ORDER changing — moving a question above the one it depends
     *     on turns a valid backward reference into a forward one, and the
     *     operator who dragged it has no reason to expect that;
     *   • ARCHIVING — a question others depend on, once inactive, stops being
     *     part of the survey a respondent sees, and every question gated on it
     *     would silently start appearing unconditionally.
     *
     * The first two are checked by re-validating the survey this edit would
     * produce; the third is refused outright, naming the questions that depend
     * on it, because there is no version of it that is not a surprise.
     */
    const touchesConditionGraph =
      parsed.data.config !== undefined ||
      parsed.data.sortOrder !== undefined ||
      parsed.data.isActive !== undefined;

    if (touchesConditionGraph) {
      const existingRefs = await loadSurveyConditionRefs(supabase, campaign.id);
      const existingProblems = new Set(
        validateSurveyConditionGraph(existingRefs).map((problem) => `${problem.code}:${problem.questionId}`)
      );

      if (parsed.data.isActive === false) {
        const dependents = findSurveyQuestionsDependingOn(existingRefs, routeParams.data.questionId);
        if (dependents.length > 0) {
          return NextResponse.json(
            {
              error: `Another question appears only when this one is answered a certain way, so archiving it would leave that question showing to everyone. Change the condition on ${dependents
                .map((dependent) => `“${dependent.prompt}”`)
                .join(", ")} first.`,
              code: "CONDITION_DEPENDENTS",
              dependents,
            },
            { status: 409 }
          );
        }
      }

      const editedRef: SurveyConditionQuestionRef & { sortOrder: number } = {
        id: routeParams.data.questionId,
        prompt: (updates.prompt as string | undefined) ?? (existing.prompt as string),
        question_type: existing.question_type as SurveyQuestionType,
        config: updates.config_json !== undefined ? updates.config_json : existing.config_json,
        sortOrder: (updates.sort_order as number | undefined) ?? (existing.sort_order as number),
      };
      /**
       * RE-ACTIVATING AN ARCHIVED QUESTION IS A GRAPH CHANGE TOO.
       *
       * `loadSurveyConditionRefs` only returns ACTIVE questions, so a question
       * being brought back is not in `existingRefs` at all — mapping over that
       * list would validate the survey WITHOUT it and let a stale condition
       * through. That is not hypothetical: archive a question, reorder the ones
       * around it, bring it back, and its once-valid backward reference is now a
       * forward one. The question then never appears to a single respondent and
       * the operator is told nothing. So the edited question is spliced in
       * explicitly, and only an archiving edit leaves it out.
       */
      const alreadyActive = existingRefs.find((ref) => ref.id === routeParams.data.questionId);
      // Keep the live option ids when we already have them; a question
      // reactivated from outside the active set simply has none known, and an
      // unknown option list skips that one check rather than inventing a
      // failure.
      const splicedRef = { ...editedRef, optionIds: alreadyActive?.optionIds };
      const proposed: (SurveyConditionQuestionRef & { sortOrder: number })[] = (
        parsed.data.isActive === false
          ? existingRefs.filter((ref) => ref.id !== routeParams.data.questionId)
          : alreadyActive
            ? // In place, so a tie on `sort_order` keeps the `created_at` order
              // `loadSurveyConditionRefs` already resolved it in. Re-appending
              // would move the edited question behind its ties and invent a
              // forward reference nobody wrote.
              existingRefs.map((ref) => (ref.id === routeParams.data.questionId ? splicedRef : ref))
            : [...existingRefs, splicedRef]
      )
        // Stable: only questions whose `sort_order` genuinely differs move.
        .sort((left, right) => left.sortOrder - right.sortOrder);

      const conditionProblems = validateSurveyConditionGraph(proposed).filter(
        (problem) => !existingProblems.has(`${problem.code}:${problem.questionId}`)
      );
      if (conditionProblems.length > 0) {
        return NextResponse.json(
          { error: conditionProblems[0].message, code: conditionProblems[0].code },
          { status: 400 }
        );
      }
    }

    const { data: question, error: updateError } = await supabase
      .from("engagement_survey_questions")
      .update(updates)
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id)
      .select(QUESTION_SELECT)
      .single();
    if (isWriteFailure(updateError)) {
      audit.error("question_update_failed", { questionId: routeParams.data.questionId, message: updateError?.message ?? "unknown" });
      return NextResponse.json({ error: "Failed to update survey question" }, { status: 500 });
    }
    // This exact row was read back through the caller's own client above, after
    // the campaign membership and engagement.write check passed. So a write that
    // matches nothing is the database refusing what the application allowed —
    // a missing permissive UPDATE policy — not a question that isn't there.
    if (writeMatchedNoRows({ data: question, error: updateError })) {
      audit.error("question_update_matched_no_rows", { campaignId: campaign.id, questionId: routeParams.data.questionId });
      return noRowsMatchedResponse({ subject: "survey question", targetWasVerified: true });
    }
    return NextResponse.json({ question });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating survey question" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.delete", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    // A question others are gated on cannot be deleted out from under them —
    // same reason archiving is refused above, and worse here because the row is
    // gone: every dependent question would start appearing to everyone, and the
    // operator would have no record of what it used to depend on.
    const conditionRefs = await loadSurveyConditionRefs(supabase, campaign.id);
    const dependents = findSurveyQuestionsDependingOn(conditionRefs, routeParams.data.questionId);
    if (dependents.length > 0) {
      return NextResponse.json(
        {
          error: `Another question appears only when this one is answered a certain way. Change the condition on ${dependents
            .map((dependent) => `“${dependent.prompt}”`)
            .join(", ")} before deleting this question.`,
          code: "CONDITION_DEPENDENTS",
          dependents,
        },
        { status: 409 }
      );
    }

    // Hard delete is data-safe: engagement_survey_answers.question_id is
    // ON DELETE SET NULL and answers snapshot question_type + prompt + answer_text,
    // so prior responses stay interpretable. (Builder UI prefers isActive=false.)
    const { error: deleteError } = await supabase
      .from("engagement_survey_questions")
      .delete()
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id);
    if (deleteError) {
      audit.error("question_delete_failed", { questionId: routeParams.data.questionId, message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete survey question" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while deleting survey question" }, { status: 500 });
  }
}
