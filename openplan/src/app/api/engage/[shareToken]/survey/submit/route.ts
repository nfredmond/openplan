import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  buildPublicSubmissionClientFingerprint,
  getPublicSubmissionUserAgent,
  PUBLIC_SUBMISSION_MAX_PER_WINDOW,
  PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES,
} from "@/lib/engagement/public-submit";
import {
  ENGAGEMENT_PHOTO_BUCKET,
  ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES,
  isEngagementPhotoPathForCampaign,
  splitEngagementPhotoPath,
} from "@/lib/engagement/photo";
import { validateSurveyAnswer, type SurveyQuestionContext } from "@/lib/engagement/survey";
import { recordOperatorNotification } from "@/lib/notifications/engagement";
import {
  loadSurveyDefinition,
  loadRecentFingerprintSessions,
  insertSurveyResponse,
  type SurveyAnswerInsert,
} from "@/lib/engagement/survey-responses";

const paramsSchema = z.object({ shareToken: z.string().min(8).max(64) });

const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().uuid(), answer: z.unknown() }))
    .max(300),
  submittedBy: z.string().trim().max(200).optional(),
  // Honeypot: bots fill this in.
  website: z.string().max(500).optional(),
});

type RouteContext = { params: Promise<{ shareToken: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.survey_submit", request);
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid share token" }, { status: 400 });

    const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const parsed = submitSchema.safeParse(bodyRead.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid survey submission", details: parsed.error.issues }, { status: 400 });

    // Honeypot: silently accept + discard.
    if (parsed.data.website && parsed.data.website.length > 0) {
      return NextResponse.json({ success: true, message: "Thank you for your response." }, { status: 201 });
    }

    // Reject duplicate answers for the same question up front.
    const submittedIds = parsed.data.answers.map((a) => a.questionId);
    if (new Set(submittedIds).size !== submittedIds.length) {
      return NextResponse.json({ error: "Duplicate answer for a question." }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("engagement_campaigns")
      .select("id, workspace_id, title, status, allow_public_submissions, submissions_closed_at, survey_one_response_per_fingerprint")
      .eq("share_token", parsedParams.data.shareToken)
      .eq("status", "active")
      .maybeSingle();
    if (campaignError) {
      audit.error("survey_campaign_lookup_failed", { message: campaignError.message, code: campaignError.code ?? null });
      return NextResponse.json({ error: "Failed to verify campaign" }, { status: 500 });
    }
    if (!campaign) return NextResponse.json({ error: "Campaign not found or not publicly available" }, { status: 404 });
    if (!campaign.allow_public_submissions || campaign.submissions_closed_at) {
      return NextResponse.json({ error: "This survey is not currently accepting responses" }, { status: 403 });
    }

    const fingerprint = buildPublicSubmissionClientFingerprint(request);

    // Per-fingerprint rate limit (recent sessions this campaign).
    const recentSessions = await loadRecentFingerprintSessions(supabase, campaign.id, fingerprint);
    const rateWindowMs = PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES * 60 * 1000;
    const recentCount = recentSessions.filter((s) => {
      const t = Date.parse(s.created_at);
      return !Number.isNaN(t) && Date.now() - t <= rateWindowMs;
    }).length;
    if (recentCount >= PUBLIC_SUBMISSION_MAX_PER_WINDOW) {
      return NextResponse.json({ error: "Too many recent responses from this connection. Please wait a few minutes and try again." }, { status: 429 });
    }

    // Load the active survey definition (service-role read of definition tables).
    const { questions, optionsByQuestion } = await loadSurveyDefinition(supabase, campaign.id);
    if (questions.length === 0) {
      return NextResponse.json({ error: "This campaign has no active survey questions." }, { status: 400 });
    }
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // Validate every submitted answer against its question definition.
    const collected: SurveyAnswerInsert[] = [];
    for (const submitted of parsed.data.answers) {
      const question = questionById.get(submitted.questionId);
      if (!question) return NextResponse.json({ error: "This survey has changed; please reload and try again.", questionId: submitted.questionId }, { status: 409 });

      const options = optionsByQuestion.get(question.id) ?? [];
      const context: SurveyQuestionContext = {
        id: question.id,
        question_type: question.question_type,
        required: question.required,
        config: question.config_json,
        optionIds: options.map((o) => o.id),
        optionLabelById: new Map(options.map((o) => [o.id, o.label])),
        optionMetaById: new Map(options.map((o) => [o.id, o.metadata_json])),
      };
      const result = validateSurveyAnswer(context, submitted.answer);
      if (!result.ok) {
        return NextResponse.json({ error: result.message, code: result.code, questionId: question.id }, { status: 400 });
      }
      if (result.isEmpty) continue; // optional-empty writes no row

      // file_upload paths are client-supplied: they must (1) match THIS campaign's
      // private-bucket prefix, and (2) actually exist as a recently-uploaded object
      // (i.e. came from this campaign's upload lane) — same posture as the comment
      // route, so a crafted path to a never-uploaded/foreign object is rejected.
      if (question.question_type === "file_upload") {
        const files = (result.answer as { files: { path: string }[] }).files ?? [];
        for (const file of files) {
          if (!isEngagementPhotoPathForCampaign(file.path, campaign.id)) {
            return NextResponse.json({ error: "Invalid file reference for this survey", questionId: question.id }, { status: 400 });
          }
          const pathParts = splitEngagementPhotoPath(file.path);
          const { data: objects, error: listError } = await supabase.storage
            .from(ENGAGEMENT_PHOTO_BUCKET)
            .list(pathParts?.folder ?? campaign.id, { limit: 1, search: pathParts?.fileName ?? "" });
          if (listError) {
            audit.error("survey_file_lookup_failed", { campaignId: campaign.id, message: listError.message });
            return NextResponse.json({ error: "Failed to verify a file upload" }, { status: 500 });
          }
          const object = (objects ?? []).find((o) => o.name === pathParts?.fileName);
          const createdAtMs = object?.created_at ? Date.parse(object.created_at) : Number.NaN;
          const lookbackMs = ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES * 60 * 1000;
          if (!object || Number.isNaN(createdAtMs) || Date.now() - createdAtMs > lookbackMs) {
            return NextResponse.json({ error: "A file upload was not found or has expired. Please re-attach it.", questionId: question.id }, { status: 400 });
          }
        }
      }

      collected.push({
        questionId: question.id,
        questionType: question.question_type,
        questionPromptSnapshot: question.prompt,
        answerJson: result.answer,
        answerText: result.answerText,
      });
    }

    // Enforce required questions (a required question with no non-empty answer fails).
    const answeredIds = new Set(collected.map((c) => c.questionId));
    const missingRequired = questions.find((q) => q.required && !answeredIds.has(q.id));
    if (missingRequired) {
      return NextResponse.json({ error: "Please answer all required questions.", questionId: missingRequired.id }, { status: 400 });
    }
    if (collected.length === 0) {
      return NextResponse.json({ error: "Please answer at least one question." }, { status: 400 });
    }

    // One-response-per-fingerprint is a soft FLAG (never a hard reject — the
    // IP-only fingerprint is shared across NAT/office/library networks).
    const isRepeatFingerprint = campaign.survey_one_response_per_fingerprint && recentSessions.length > 0;
    const autoFlagReason = isRepeatFingerprint ? "repeat_fingerprint" : null;
    const status = autoFlagReason ? "flagged" : "pending";

    const metadata = {
      submitted_via: "public_portal_survey",
      source_fingerprint: fingerprint,
      user_agent: getPublicSubmissionUserAgent(request),
      received_at: new Date().toISOString(),
      auto_flag_reason: autoFlagReason,
      answered_count: collected.length,
    };

    const inserted = await insertSurveyResponse(supabase, {
      campaignId: campaign.id,
      submittedBy: parsed.data.submittedBy?.trim() || null,
      sourceType: "public",
      status,
      respondentFingerprint: fingerprint,
      metadata,
      answers: collected,
    });
    if (!inserted.ok) {
      audit.error("survey_response_insert_failed", { campaignId: campaign.id, message: inserted.error });
      return NextResponse.json({ error: "Failed to submit your response" }, { status: 500 });
    }

    // Best-effort operator notification — the response is already saved.
    await recordOperatorNotification(supabase, {
      workspaceId: campaign.workspace_id,
      campaignId: campaign.id,
      type: "survey_response",
      title: `New survey response on “${campaign.title}”`,
      body: `${collected.length} answer${collected.length === 1 ? "" : "s"} submitted for review.`,
      payload: { sessionId: inserted.sessionId, reviewStatus: status, answered: collected.length },
    }).catch(() => {});

    audit.info("survey_response_accepted", { campaignId: campaign.id, sessionId: inserted.sessionId, reviewStatus: status, answered: collected.length });
    return NextResponse.json(
      {
        success: true,
        message: "Thank you for your response. It will be reviewed by the project team.",
        sessionId: inserted.sessionId,
        reviewStatus: status,
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("survey_submit_unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while submitting your response" }, { status: 500 });
  }
}
