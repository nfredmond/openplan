import { makeEngagementCategorySlug } from "@/lib/engagement/catalog";
import { SURVEY_QUESTION_TYPES, validateSurveyConfig } from "@/lib/engagement/survey";
import type { CampaignTemplate } from "@/lib/engagement/campaign-templates";
import type { createApiAuditLogger } from "@/lib/observability/audit";

/**
 * Applies a campaign template's starter content — categories, DRAFT survey
 * questions, and their answer options — to a campaign that the creation route
 * has just inserted.
 *
 * This lives beside the creation route rather than in `lib/engagement` because
 * it is that route's own second half: it runs inside the route's audit scope,
 * under the same signed-in planner's RLS-scoped client, and nothing else may
 * call it. The validation is the SAME validation the manual paths use —
 * `makeEngagementCategorySlug` from the category route's insert, and
 * `validateSurveyConfig` from the survey-question route's — so a template
 * cannot write a row the builder could not.
 *
 * WHY EVERY QUESTION IS A DRAFT, WITH NO WAY TO SAY OTHERWISE. The template's
 * wording was authored in this repository, not by the planner clicking Create.
 * The same rule that governs Planner Agent question drafts (decision of
 * 2026-08-03) applies: wording the accountable person did not write lands in
 * the survey builder as a badged draft, invisible to the public, and a PERSON
 * publishes it. `CampaignTemplateQuestion` carries no status field, and the
 * literal below is the only expression that decides it.
 *
 * Failure shape: inserts run sequentially and the first failure stops the
 * apply. The campaign already exists at that point, so the caller reports the
 * campaign as created and the template as NOT fully applied — an honest
 * partial state the planner can finish by hand — rather than pretending either
 * that nothing happened or that everything did.
 */

type InsertResultLike = PromiseLike<{ data: { id: string } | null; error: { message: string; code?: string | null } | null }>;

type TemplateApplyClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => { single: () => InsertResultLike };
    };
  };
};

export type TemplateApplyOutcome =
  | { applied: true; categoriesCreated: number; questionsCreated: number; optionsCreated: number }
  | { applied: false; error: string };

export async function applyCampaignTemplate(
  supabase: unknown,
  audit: ReturnType<typeof createApiAuditLogger>,
  args: { campaignId: string; userId: string; template: CampaignTemplate }
): Promise<TemplateApplyOutcome> {
  const client = supabase as TemplateApplyClient;
  const { campaignId, userId, template } = args;

  let categoriesCreated = 0;
  let questionsCreated = 0;
  let optionsCreated = 0;

  for (const category of template.categories) {
    const { data, error } = await client
      .from("engagement_categories")
      .insert({
        campaign_id: campaignId,
        label: category.label.trim(),
        slug: makeEngagementCategorySlug(category.label),
        description: category.description.trim() || null,
        sort_order: category.sortOrder,
        color: null,
        icon: null,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      audit.error("template_category_insert_failed", {
        campaignId,
        templateId: template.id,
        categoryLabel: category.label,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return {
        applied: false,
        error: `The "${category.label}" category could not be created.`,
      };
    }
    categoriesCreated += 1;
  }

  for (const question of template.questions) {
    // The same config validation the survey builder's write path runs. The
    // registry test enforces this ahead of time; running it here anyway means a
    // registry mistake fails loudly at apply time instead of writing a config
    // the answer validator would later choke on.
    const configResult = validateSurveyConfig(question.questionType, question.config ?? {});
    if (!configResult.ok) {
      audit.error("template_question_config_invalid", {
        campaignId,
        templateId: template.id,
        questionType: question.questionType,
        message: configResult.message,
      });
      return { applied: false, error: `A template question's configuration is invalid: ${configResult.message}` };
    }

    const usesOptions = SURVEY_QUESTION_TYPES[question.questionType].usesOptions;
    const options = question.options ?? [];
    if (!usesOptions && options.length > 0) {
      // Mirrors the options route's own refusal for these types.
      audit.error("template_question_options_invalid", {
        campaignId,
        templateId: template.id,
        questionType: question.questionType,
      });
      return { applied: false, error: "A template question of this type does not use options." };
    }

    const { data: questionRow, error: questionError } = await client
      .from("engagement_survey_questions")
      .insert({
        campaign_id: campaignId,
        category_id: null,
        question_type: question.questionType,
        prompt: question.prompt,
        help_text: question.helpText?.trim() || null,
        required: question.required ?? false,
        sort_order: question.sortOrder,
        config_json: configResult.config,
        // ALWAYS a draft. Not read from the template — the type cannot express
        // a status — and not conditional on anything. A person publishes it
        // from the survey builder, or it is never asked of anybody.
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();

    if (questionError || !questionRow) {
      audit.error("template_question_insert_failed", {
        campaignId,
        templateId: template.id,
        questionType: question.questionType,
        message: questionError?.message ?? "unknown",
        code: questionError?.code ?? null,
      });
      return { applied: false, error: "A template survey question could not be created." };
    }
    questionsCreated += 1;

    for (const option of options) {
      const { data: optionRow, error: optionError } = await client
        .from("engagement_survey_question_options")
        .insert({
          question_id: questionRow.id,
          campaign_id: campaignId, // denormalized; the DB trigger enforces it matches the question
          label: option.label,
          value: null,
          sort_order: option.sortOrder,
          metadata_json: {},
        })
        .select("id")
        .single();

      if (optionError || !optionRow) {
        audit.error("template_option_insert_failed", {
          campaignId,
          templateId: template.id,
          questionId: questionRow.id,
          message: optionError?.message ?? "unknown",
          code: optionError?.code ?? null,
        });
        return { applied: false, error: "A template answer option could not be created." };
      }
      optionsCreated += 1;
    }
  }

  return { applied: true, categoriesCreated, questionsCreated, optionsCreated };
}
