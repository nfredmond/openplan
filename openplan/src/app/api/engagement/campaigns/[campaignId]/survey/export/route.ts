import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  flattenSurveyAnswerForExport,
  loadSurveyAnswersForExport,
  loadSurveyOptionLabels,
  loadSurveyResponseSessions,
  type SurveyAnswerExportRow,
  type SurveyResponseSessionRow,
} from "@/lib/engagement/survey-responses";
import { escapeCsvField } from "@/lib/export/csv";

/**
 * Survey export — the RESPONSE REGISTER (CSV) and the FULL ANSWER EXPORT
 * (CSV or JSON, `?content=answers`).
 *
 * Survey responses were collected and could not leave the product in any form,
 * so an agency had no way to put its own participation record — or what the
 * community actually said — into the documentation it has to produce. The
 * register was the first door out; the answer export is the second.
 *
 * WHAT NEITHER FILE CONTAINS, and why — a file leaves the product and may be
 * emailed onward, so it carries less than the operator can see, never more:
 *   • `respondent_fingerprint` — an IP-derived device fingerprint the resident
 *     never supplied and no surface displays. Neither loader selects it, so its
 *     absence is structural rather than a habit.
 *   • `submitted_by` — documented in the schema as "optional self-entered
 *     name/email". No operator surface in this product displays it today, and an
 *     export must not be the first place a resident's name or address appears.
 *   • `moderation_notes` — an internal staff note; the sibling item export
 *     already excludes it from the portable GeoJSON for exactly this reason.
 *   • self-reported demographics — held to k-anonymized aggregate reading by
 *     design (`src/lib/engagement/demographics.ts`, cells under 5 suppressed).
 *     A per-response row would be a cell of one, which no k-anonymity rule can
 *     survive, so demographics are EXCLUDED from row-level export outright and
 *     the file says so. They are also attached to engagement items, not to
 *     survey sessions, so no join here could reach them even carelessly.
 *
 * ANSWER CONTENT is exportable as of the `content=answers` form:
 * `loadSurveyAnswersForExport` attributes each answer to its response session,
 * and every row renders `question_prompt_snapshot` — the prompt as the
 * respondent read it — never the live question text, so history survives
 * question edits. The export carries ALL moderation statuses with a per-row
 * status column (filterable with `?status=`), because no code path in this
 * product yet moves a response from `pending` to `approved`, and an
 * approved-only export would therefore be empty forever.
 *
 * AUTH mirrors the sibling item export exactly: an authenticated workspace
 * member with `engagement.read` on the campaign's workspace. The response tables
 * are RLS-on with zero policies, so the READ runs under the service-role client
 * only AFTER that membership check has passed — the same two-client pattern the
 * campaign page uses for survey results.
 */

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const SESSION_STATUSES = ["pending", "approved", "rejected", "flagged"] as const;
const statusSchema = z.enum(SESSION_STATUSES);

type RouteContext = { params: Promise<{ campaignId: string }> };

const REGISTER_COLUMNS = [
  "response_id",
  "status",
  "source_type",
  "received_at",
  "updated_at",
] as const;

// Escaping lives in the SHARED layer (`@/lib/export/csv`), which also
// neutralizes leading formula characters: resident answers are free text, and
// an answer starting `=`, `+`, `-`, `@` (or tab/CR) must open as text in the
// planner's spreadsheet, never as a formula. A resident-typed numeric answer
// like "-5" is deliberately included in that rule — it arrives as untrusted
// text, and "'-5" shown as text is the safe rendering of it.

/*
 * NOTHING BUT A ROUTE HANDLER MAY BE EXPORTED FROM A `route.ts`.
 * These two helpers were exported for readability and nothing imported them.
 * `next build` rejects the file outright ("buildSurveyRegisterPreamble is not a
 * valid Route export field") while `tsc --noEmit` and the whole vitest suite
 * stay green — the export contract is a Next.js rule, not a TypeScript one, so
 * only the real build sees it. Test them by driving `GET`, which is what the
 * suite already does; if one ever needs a direct import, move it to a sibling
 * `_register.ts`, never re-export it from here.
 */

/** A `#` line must stay one line — a campaign title is operator-supplied text. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The file states what it contains, because the sentence shown in the UI does
 * not travel with the download.
 *
 * THE ZERO-ROW LINE IS A CLAIM, AND THE ROUTE EARNED THE RIGHT TO MAKE IT.
 * `loadSurveyResponseSessions` now returns `{ rows, error }`, so a failed read
 * leaves here as a 500 and never reaches this function. Every preamble this
 * builds therefore describes a read that succeeded, which is what licenses the
 * plain "0 survey responses recorded". Should the loader ever go back to
 * swallowing its error, this line becomes a lie again — that is what
 * `survey-responses-can-be-exported.test.tsx` holds shut.
 */
function buildSurveyRegisterPreamble(input: {
  campaignId: string;
  campaignTitle: string;
  exportedAt: string;
  rowCount: number;
  statusFilter: string | null;
}): string[] {
  const scope = input.statusFilter ? ` with status "${input.statusFilter}"` : "";
  // A ZERO HAS TO CARRY ITS FILTER. "0 survey responses recorded" is a claim
  // about the whole campaign, and a planner who filtered to `flagged` would be
  // reading it about a campaign that may have hundreds.
  const countLine =
    input.rowCount === 0
      ? input.statusFilter
        ? `# 0 rows: no survey response has status "${input.statusFilter}". This says nothing about the rest of the campaign.`
        : "# 0 survey responses recorded."
      : `# ${input.rowCount} survey response${input.rowCount === 1 ? "" : "s"} recorded${scope}.`;

  return [
    `# OpenPlan survey response register — campaign "${oneLine(input.campaignTitle)}" (${input.campaignId})`,
    `# Exported ${input.exportedAt}.`,
    countLine,
    "# Contains: one row per survey response received, with the channel it arrived through, its moderation status and its timestamps.",
    "# Excludes: respondent names and contact details, device fingerprints, self-reported demographics (read only as suppressed aggregates), internal moderation notes, and answer content (exported separately — add content=answers to this address).",
  ];
}

function buildSurveyRegisterCsv(
  sessions: SurveyResponseSessionRow[],
  preamble: string[]
): string {
  const rows = sessions.map((session) =>
    [
      escapeCsvField(session.id),
      escapeCsvField(session.status),
      escapeCsvField(session.source_type),
      escapeCsvField(session.created_at),
      escapeCsvField(session.updated_at),
    ].join(",")
  );
  return [...preamble, REGISTER_COLUMNS.join(","), ...rows].join("\n");
}

// ── Answer export (content=answers) ─────────────────────────────────────────

const ANSWER_COLUMNS = [
  "response_id",
  "response_status",
  "source_type",
  "received_at",
  "question_id",
  "question_type",
  "question_prompt",
  "answer",
] as const;

/**
 * Stated in the file itself, because the reader of the file is not the planner
 * who clicked export. A per-response demographics column would be a k-anonymity
 * cell of one — no suppression rule survives row-level granularity — so the
 * block is excluded outright rather than thinned.
 */
const DEMOGRAPHICS_EXCLUSION_STATEMENT =
  "Self-reported demographics are not included: OpenPlan reads them only as k-anonymized aggregates with small groups suppressed, and a per-response row cannot satisfy that rule. Use the campaign's demographics summary for the aggregate.";

/** An answer that outlived its question AND its snapshot must still say so. */
const PROMPT_NOT_RECORDED = "(prompt not recorded)";

function groupAnswersBySession(
  answers: SurveyAnswerExportRow[]
): Map<string, SurveyAnswerExportRow[]> {
  const bySession = new Map<string, SurveyAnswerExportRow[]>();
  for (const answer of answers) {
    const arr = bySession.get(answer.session_id) ?? [];
    arr.push(answer);
    bySession.set(answer.session_id, arr);
  }
  return bySession;
}

function buildSurveyAnswersPreamble(input: {
  campaignId: string;
  campaignTitle: string;
  exportedAt: string;
  responseCount: number;
  answerCount: number;
  statusFilter: string | null;
}): string[] {
  const scope = input.statusFilter ? ` with status "${input.statusFilter}"` : "";
  const countLine =
    input.responseCount === 0
      ? input.statusFilter
        ? `# 0 rows: no survey response has status "${input.statusFilter}". This says nothing about the rest of the campaign.`
        : "# 0 survey responses recorded."
      : `# ${input.answerCount} answer${input.answerCount === 1 ? "" : "s"} across ${input.responseCount} survey response${input.responseCount === 1 ? "" : "s"}${scope}.`;

  return [
    `# OpenPlan survey answer export — campaign "${oneLine(input.campaignTitle)}" (${input.campaignId})`,
    `# Exported ${input.exportedAt}.`,
    countLine,
    "# Contains: one row per answer, attributed to its response, with the question prompt as the respondent read it — a snapshot that survives later question edits.",
    "# Excludes: respondent names and contact details, device fingerprints, and internal moderation notes. File-upload answers list file names and counts, never file contents.",
    `# ${DEMOGRAPHICS_EXCLUSION_STATEMENT}`,
  ];
}

function buildSurveyAnswersCsv(
  sessions: SurveyResponseSessionRow[],
  answersBySession: Map<string, SurveyAnswerExportRow[]>,
  optionLabelById: Map<string, string>,
  preamble: string[]
): string {
  const rows: string[] = [];
  for (const session of sessions) {
    for (const answer of answersBySession.get(session.id) ?? []) {
      rows.push(
        [
          escapeCsvField(session.id),
          escapeCsvField(session.status),
          escapeCsvField(session.source_type),
          escapeCsvField(session.created_at),
          escapeCsvField(answer.question_id),
          escapeCsvField(answer.question_type),
          escapeCsvField(answer.question_prompt_snapshot ?? PROMPT_NOT_RECORDED),
          escapeCsvField(flattenSurveyAnswerForExport(answer, optionLabelById).text),
        ].join(",")
      );
    }
  }
  return [...preamble, ANSWER_COLUMNS.join(","), ...rows].join("\n");
}

function buildSurveyAnswersJson(input: {
  campaignId: string;
  campaignTitle: string;
  exportedAt: string;
  statusFilter: string | null;
  sessions: SurveyResponseSessionRow[];
  answersBySession: Map<string, SurveyAnswerExportRow[]>;
  optionLabelById: Map<string, string>;
  answerCount: number;
}) {
  return {
    export: "survey_answers",
    campaign: { id: input.campaignId, title: input.campaignTitle },
    exported_at: input.exportedAt,
    status_filter: input.statusFilter,
    response_count: input.sessions.length,
    answer_count: input.answerCount,
    contains:
      "One entry per survey response; each answer carries the question prompt as the respondent read it — a snapshot that survives later question edits.",
    excludes: [
      "respondent names and contact details",
      "device fingerprints",
      "internal moderation notes",
      "file contents (file answers list names and counts only)",
    ],
    demographics: DEMOGRAPHICS_EXCLUSION_STATEMENT,
    responses: input.sessions.map((session) => ({
      response_id: session.id,
      status: session.status,
      source_type: session.source_type,
      received_at: session.created_at,
      updated_at: session.updated_at,
      answers: (input.answersBySession.get(session.id) ?? []).map((answer) => {
        const flattened = flattenSurveyAnswerForExport(answer, input.optionLabelById);
        return {
          question_id: answer.question_id,
          question_type: answer.question_type,
          question_prompt: answer.question_prompt_snapshot ?? PROMPT_NOT_RECORDED,
          answer: flattened.value,
          answer_text: flattened.text,
        };
      }),
    })),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.survey.export", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const content = request.nextUrl.searchParams.get("content") ?? "register";
    if (content !== "register" && content !== "answers") {
      return NextResponse.json({ error: "Supported content: register, answers" }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get("format") ?? "csv";
    if (content === "register" && format !== "csv") {
      return NextResponse.json(
        { error: "The response register supports: csv. The answer export (content=answers) supports csv and json." },
        { status: 400 }
      );
    }
    if (content === "answers" && format !== "csv" && format !== "json") {
      return NextResponse.json({ error: "Supported formats: csv, json" }, { status: 400 });
    }

    const rawStatus = request.nextUrl.searchParams.get("status");
    let statusFilter: (typeof SESSION_STATUSES)[number] | null = null;
    if (rawStatus !== null) {
      const parsedStatus = statusSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        return NextResponse.json(
          { error: `Supported statuses: ${SESSION_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      statusFilter = parsedStatus.data;
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(
      supabase,
      parsedParams.data.campaignId,
      user.id,
      "engagement.read"
    );
    if (access.error) {
      audit.error("survey_export_access_failed", {
        campaignId: parsedParams.data.campaignId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
    }
    if (!access.campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    // Membership is proven above; the response tables carry no RLS policies, so
    // the reads themselves run service-role and stay inside the confined reader.
    const responsesClient = createServiceRoleClient();
    const sessions = await loadSurveyResponseSessions(
      responsesClient,
      access.campaign.id,
      statusFilter ? { status: statusFilter } : {}
    );
    // A file is the worst place for a failed read to land: it leaves the product,
    // gets attached to a Title VI or grant deliverable, and outlives every log
    // line that could have corrected it. So the failure stops here as a status.
    const failure = classifyRouteReadFailure("survey responses", sessions);
    if (failure) {
      audit.error("survey_export_read_failed", {
        campaignId: access.campaign.id,
        content,
        statusFilter,
        message: failure.message,
      });
      return NextResponse.json(failure.body, { status: failure.status });
    }

    const exportedAt = new Date().toISOString();

    if (content === "register") {
      const csv = buildSurveyRegisterCsv(
        sessions.rows,
        buildSurveyRegisterPreamble({
          campaignId: access.campaign.id,
          campaignTitle: access.campaign.title ?? "",
          exportedAt,
          rowCount: sessions.rows.length,
          statusFilter,
        })
      );

      audit.info("survey_export_completed", {
        userId: user.id,
        campaignId: access.campaign.id,
        content,
        format,
        statusFilter,
        rowCount: sessions.rows.length,
        durationMs: Date.now() - startedAt,
      });

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="survey-responses-${access.campaign.id}.csv"`,
        },
      });
    }

    // ── content=answers: the full answer export ──────────────────────────────
    const answers = await loadSurveyAnswersForExport(responsesClient, access.campaign.id);
    const answersFailure = classifyRouteReadFailure("survey answers", answers);
    if (answersFailure) {
      audit.error("survey_export_read_failed", {
        campaignId: access.campaign.id,
        content,
        statusFilter,
        message: answersFailure.message,
      });
      return NextResponse.json(answersFailure.body, { status: answersFailure.status });
    }

    // A failed OPTIONS read is refused too: it would render every choice,
    // ranking and budget answer as "(removed option)" — a false claim about
    // the survey, in a file, over an outage.
    const options = await loadSurveyOptionLabels(responsesClient, access.campaign.id);
    const optionsFailure = classifyRouteReadFailure("survey question options", options);
    if (optionsFailure) {
      audit.error("survey_export_read_failed", {
        campaignId: access.campaign.id,
        content,
        statusFilter,
        message: optionsFailure.message,
      });
      return NextResponse.json(optionsFailure.body, { status: optionsFailure.status });
    }

    const optionLabelById = new Map(options.rows.map((option) => [option.id, option.label]));
    const answersBySession = groupAnswersBySession(answers.rows);
    // Count only answers whose session survived the status filter — the answers
    // read is campaign-wide, the sessions read is the filtered register.
    const answerCount = sessions.rows.reduce(
      (count, session) => count + (answersBySession.get(session.id)?.length ?? 0),
      0
    );

    audit.info("survey_export_completed", {
      userId: user.id,
      campaignId: access.campaign.id,
      content,
      format,
      statusFilter,
      rowCount: sessions.rows.length,
      answerCount,
      durationMs: Date.now() - startedAt,
    });

    if (format === "json") {
      const payload = buildSurveyAnswersJson({
        campaignId: access.campaign.id,
        campaignTitle: access.campaign.title ?? "",
        exportedAt,
        statusFilter,
        sessions: sessions.rows,
        answersBySession,
        optionLabelById,
        answerCount,
      });
      return NextResponse.json(payload, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename="survey-answers-${access.campaign.id}.json"`,
        },
      });
    }

    const csv = buildSurveyAnswersCsv(
      sessions.rows,
      answersBySession,
      optionLabelById,
      buildSurveyAnswersPreamble({
        campaignId: access.campaign.id,
        campaignTitle: access.campaign.title ?? "",
        exportedAt,
        responseCount: sessions.rows.length,
        answerCount,
        statusFilter,
      })
    );

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="survey-answers-${access.campaign.id}.csv"`,
      },
    });
  } catch (error) {
    audit.error("survey_export_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error during survey export" }, { status: 500 });
  }
}
