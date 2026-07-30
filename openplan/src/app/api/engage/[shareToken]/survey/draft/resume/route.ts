import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { SURVEY_DRAFT_RETENTION_DAYS } from "@/lib/engagement/survey";
import {
  hashSurveyDraftResumeToken,
  loadOpenSurveyCampaign,
  readSurveyDraftPayload,
  surveyDraftResumeTokenSchema,
} from "@/lib/engagement/survey-drafts";
import { loadSurveyDraftByTokenHash } from "@/lib/engagement/survey-responses";

/**
 * REOPEN A PART-FINISHED SURVEY.
 *
 * POST, NOT GET, AND THE CREDENTIAL IS IN THE BODY. A resume token in a query
 * string ends up in browser history, in the `Referer` header of the next
 * outbound click, and in every proxy access log between the resident and this
 * server — for a credential that reads a stranger's part-finished answers,
 * demographics included. There is no GET here on purpose, and a link that would
 * carry the token is deliberately not offered anywhere in the product.
 *
 * The token is never compared against a stored token, because none is stored:
 * the digest of what the browser sends is looked up directly.
 */

const paramsSchema = z.object({ shareToken: z.string().min(8).max(64) });
const bodySchema = z.object({ resumeToken: surveyDraftResumeTokenSchema }).strict();

type RouteContext = { params: Promise<{ shareToken: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engage.survey_draft_resume", request);
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid share token" }, { status: 400 });

    const bodyRead = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const parsed = bodySchema.safeParse(bodyRead.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid resume request" }, { status: 400 });

    const supabase = createServiceRoleClient();
    const campaignResult = await loadOpenSurveyCampaign(supabase, parsedParams.data.shareToken);
    if (!campaignResult.ok) {
      return NextResponse.json({ error: campaignResult.error }, { status: campaignResult.status });
    }

    const read = await loadSurveyDraftByTokenHash(
      supabase,
      campaignResult.campaign.id,
      hashSurveyDraftResumeToken(parsed.data.resumeToken)
    );
    // A FAILED READ IS NOT AN ABSENT DRAFT. Answering 404 here would tell a
    // participant their saved answers are gone on the strength of a query that
    // errored — a false statement about their own work, and one that would send
    // them to a blank form with answers still sitting in the database.
    if (!read.ok) {
      audit.error("survey_draft_read_failed", { campaignId: campaignResult.campaign.id, message: read.error });
      return NextResponse.json({ error: "We could not check for saved answers right now." }, { status: 500 });
    }
    if (!read.draft) {
      return NextResponse.json(
        { error: "Your saved answers are no longer available.", code: "DRAFT_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      answers: readSurveyDraftPayload(read.draft.answers_json),
      savedAt: read.draft.updated_at,
      expiresAt: read.draft.expires_at,
      retentionDays: SURVEY_DRAFT_RETENTION_DAYS,
    });
  } catch (error) {
    audit.error("survey_draft_unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while reopening your answers" }, { status: 500 });
  }
}
