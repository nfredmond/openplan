import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { buildPublicSubmissionClientFingerprint } from "@/lib/engagement/public-submit";
import {
  SURVEY_DRAFT_RETENTION_DAYS,
  SURVEY_QUESTION_TYPES,
  resolveSurveyVisibility,
} from "@/lib/engagement/survey";
import {
  SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT,
  buildSurveyDraftPayload,
  hashSurveyDraftResumeToken,
  loadOpenSurveyCampaign,
  mintSurveyDraftResumeToken,
  surveyDraftExpiryFrom,
  surveyDraftResumeTokenSchema,
  surveyDraftAnswersSchema,
  type SurveyDraftAnswer,
} from "@/lib/engagement/survey-drafts";
import {
  countLiveSurveyDrafts,
  deleteSurveyDraftByTokenHash,
  insertSurveyDraft,
  loadSurveyDefinition,
  purgeExpiredSurveyDrafts,
  updateSurveyDraft,
} from "@/lib/engagement/survey-responses";

/**
 * SAVE A PART-FINISHED SURVEY, AND COME BACK TO IT.
 *
 * WHAT THIS ROUTE IS NOT. It is not a submission path. Nothing it writes is
 * counted as a response, appears in a moderation queue, or reaches a
 * representativeness reading — the rows live in their own table for exactly that
 * reason (see 20260730000003). The submit route is the only way a response comes
 * into existence, and it deletes the draft when it does.
 *
 * WHAT IS AND IS NOT VALIDATED HERE. A draft is unfinished by definition, so the
 * submit rules would refuse the very state a resident needs saved (a blank
 * required question, half an allocated budget). What IS enforced:
 *   • the question belongs to THIS campaign's active survey — a draft that
 *     names somebody else's question is not a partial answer, it is a probe;
 *   • the answer matches its type's STRUCTURAL shape, so the stored blob is
 *     always something the form can render back and the submit route can read;
 *   • answers to questions the respondent's other answers have made
 *     inapplicable are dropped, by the same rule the submit route applies.
 *
 * FILE UPLOADS ARE DELIBERATELY NOT SAVED. An uploaded file is accepted by the
 * submit route only if the storage object was created within
 * ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES (two hours), while a draft lives for
 * thirty days. Storing the path would produce a resume that looks complete and
 * then fails at submission, blaming the participant for a limit nobody told them
 * about. The form says the attachments have to be added again, which is true.
 */

const paramsSchema = z.object({ shareToken: z.string().min(8).max(64) });

const saveSchema = z
  .object({
    answers: surveyDraftAnswersSchema,
    /** Present when updating a draft this browser already holds. */
    resumeToken: surveyDraftResumeTokenSchema.optional(),
  })
  .strict();

const discardSchema = z.object({ resumeToken: surveyDraftResumeTokenSchema }).strict();

type RouteContext = { params: Promise<{ shareToken: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.survey_draft_save", request);
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid share token" }, { status: 400 });

    const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const parsed = saveSchema.safeParse(bodyRead.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid draft payload", details: parsed.error.issues }, { status: 400 });
    }

    const submittedIds = parsed.data.answers.map((answer) => answer.questionId);
    if (new Set(submittedIds).size !== submittedIds.length) {
      return NextResponse.json({ error: "Duplicate answer for a question." }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const campaignResult = await loadOpenSurveyCampaign(supabase, parsedParams.data.shareToken);
    if (!campaignResult.ok) {
      return NextResponse.json({ error: campaignResult.error }, { status: campaignResult.status });
    }
    const { campaign } = campaignResult;

    // Retention is enforced by ordinary use of the campaign being touched.
    await purgeExpiredSurveyDrafts(supabase, campaign.id);

    const { questions } = await loadSurveyDefinition(supabase, campaign.id);
    if (questions.length === 0) {
      return NextResponse.json({ error: "This campaign has no active survey questions." }, { status: 400 });
    }
    const questionById = new Map(questions.map((question) => [question.id, question]));

    // Structural-only screening. See the block comment above for why the submit
    // validator is deliberately NOT applied to a part-finished response.
    const answersByQuestion: Record<string, unknown> = {};
    let filesDropped = false;
    for (const submitted of parsed.data.answers) {
      const question = questionById.get(submitted.questionId);
      if (!question) {
        return NextResponse.json(
          { error: "This survey has changed; please reload and try again.", questionId: submitted.questionId },
          { status: 409 }
        );
      }
      if (question.question_type === "file_upload") {
        filesDropped = true;
        continue;
      }
      const shape = SURVEY_QUESTION_TYPES[question.question_type]?.answerSchema;
      if (!shape || !shape.safeParse(submitted.answer).success) {
        return NextResponse.json(
          { error: "An answer does not match the expected shape.", questionId: question.id },
          { status: 400 }
        );
      }
      answersByQuestion[question.id] = submitted.answer;
    }

    // The same conditional rule the submit route and the browser apply: an
    // answer to a question this respondent's other answers make inapplicable is
    // not saved, so a resumed draft can never re-submit one.
    const visibility = resolveSurveyVisibility(
      questions.map((question) => ({ id: question.id, question_type: question.question_type, config: question.config_json })),
      answersByQuestion
    );
    const answers: SurveyDraftAnswer[] = Object.entries(visibility.answers).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));

    const payload = buildSurveyDraftPayload(answers);
    const expiresAt = surveyDraftExpiryFrom().toISOString();
    const fingerprint = buildPublicSubmissionClientFingerprint(request);

    if (parsed.data.resumeToken) {
      const tokenHash = hashSurveyDraftResumeToken(parsed.data.resumeToken);
      const updated = await updateSurveyDraft(supabase, {
        campaignId: campaign.id,
        resumeTokenHash: tokenHash,
        answersJson: payload,
        answeredCount: answers.length,
        expiresAt,
      });
      if (!updated.ok) {
        audit.error("survey_draft_update_failed", { campaignId: campaign.id, message: updated.error });
        return NextResponse.json({ error: "Your answers could not be saved right now." }, { status: 500 });
      }
      // No row matched: the draft expired or was discarded. Saying so — rather
      // than quietly minting a second draft this browser has no token for — is
      // what lets the form tell the participant the truth about their answers.
      if (!updated.draft) {
        return NextResponse.json(
          { error: "Your saved answers are no longer available.", code: "DRAFT_NOT_FOUND" },
          { status: 404 }
        );
      }
      audit.info("survey_draft_updated", { campaignId: campaign.id, answered: answers.length });
      return NextResponse.json({
        saved: true,
        answeredCount: answers.length,
        savedAt: updated.draft.updated_at,
        expiresAt: updated.draft.expires_at,
        retentionDays: SURVEY_DRAFT_RETENTION_DAYS,
        filesNotSaved: filesDropped,
      });
    }

    const live = await countLiveSurveyDrafts(supabase, campaign.id, fingerprint);
    if (!live.ok) {
      audit.error("survey_draft_count_failed", { campaignId: campaign.id, message: live.error });
      return NextResponse.json({ error: "Your answers could not be saved right now." }, { status: 500 });
    }
    if (live.count >= SURVEY_DRAFT_MAX_LIVE_PER_FINGERPRINT) {
      return NextResponse.json(
        { error: "Too many part-finished responses are already saved from this connection." },
        { status: 429 }
      );
    }

    // The ONLY moment the raw token exists. It is returned once and never stored.
    const resumeToken = mintSurveyDraftResumeToken();
    const created = await insertSurveyDraft(supabase, {
      campaignId: campaign.id,
      resumeTokenHash: hashSurveyDraftResumeToken(resumeToken),
      respondentFingerprint: fingerprint,
      answersJson: payload,
      answeredCount: answers.length,
      expiresAt,
    });
    if (!created.ok) {
      audit.error("survey_draft_insert_failed", { campaignId: campaign.id, message: created.error });
      return NextResponse.json({ error: "Your answers could not be saved right now." }, { status: 500 });
    }

    audit.info("survey_draft_created", { campaignId: campaign.id, answered: answers.length });
    return NextResponse.json(
      {
        saved: true,
        resumeToken,
        answeredCount: answers.length,
        savedAt: created.draft.updated_at,
        expiresAt: created.draft.expires_at,
        retentionDays: SURVEY_DRAFT_RETENTION_DAYS,
        filesNotSaved: filesDropped,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("survey_draft_unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while saving your answers" }, { status: 500 });
  }
}

/** Discard a saved draft on the participant's own request. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.survey_draft_discard", request);
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid share token" }, { status: 400 });

    const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const parsed = discardSchema.safeParse(bodyRead.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid discard request" }, { status: 400 });

    const supabase = createServiceRoleClient();
    // A CLOSED survey must still be able to DISCARD: a participant deleting
    // their own part-finished answers is not a submission, and refusing it
    // because the consultation ended would leave their data sitting there.
    const { data, error } = await supabase
      .from("engagement_campaigns")
      .select("id")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 });
    const campaign = data as { id: string } | null;
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const deleted = await deleteSurveyDraftByTokenHash(
      supabase,
      campaign.id,
      hashSurveyDraftResumeToken(parsed.data.resumeToken)
    );
    if (!deleted.ok) {
      audit.error("survey_draft_delete_failed", { campaignId: campaign.id, message: deleted.error });
      return NextResponse.json({ error: "Your saved answers could not be discarded right now." }, { status: 500 });
    }
    return NextResponse.json({ discarded: true });
  } catch (error) {
    audit.error("survey_draft_unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while discarding your answers" }, { status: 500 });
  }
}
