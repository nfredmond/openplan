import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCampaignAccess } from "@/lib/engagement/api";
import {
  loadSurveyResponseSessions,
  type SurveyResponseSessionRow,
} from "@/lib/engagement/survey-responses";

/**
 * Survey RESPONSE REGISTER export (CSV).
 *
 * Survey responses were collected and could not leave the product in any form,
 * so an agency had no way to put its own participation record into the
 * documentation it has to produce. This is the first door out.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN, and why — the file leaves the product
 * and may be emailed onward, so it carries less than the operator can see, never
 * more:
 *   • `respondent_fingerprint` — an IP-derived device fingerprint the resident
 *     never supplied and no surface displays. `loadSurveyResponseSessions` does
 *     not even select it, so its absence is structural rather than a habit.
 *   • `submitted_by` — documented in the schema as "optional self-entered
 *     name/email". No operator surface in this product displays it today, and an
 *     export must not be the first place a resident's name or address appears.
 *   • `moderation_notes` — an internal staff note; the sibling item export
 *     already excludes it from the portable GeoJSON for exactly this reason.
 *   • self-reported demographics — held to k-anonymized aggregate reading by
 *     design (`src/lib/engagement/demographics.ts`); a row-level export would
 *     break that promise. They are also attached to items, not to survey
 *     sessions, so no join here could reach them.
 *   • ANSWER CONTENT — not yet exportable. The only answer reader in the
 *     confined module (`loadApprovedSurveyAnswers`) returns approved answers
 *     with no `session_id`, so answers cannot be attributed to a response, and
 *     no code path in this product can move a response from `pending` to
 *     `approved` in the first place. Both are recorded in the preamble rather
 *     than papered over.
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

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
    "# Excludes: respondent names and contact details, device fingerprints, self-reported demographics (read only as suppressed aggregates), internal moderation notes, and answer content (not yet exportable).",
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

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.survey.export", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get("format") ?? "csv";
    if (format !== "csv") {
      return NextResponse.json({ error: "Supported formats: csv" }, { status: 400 });
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
    // the read itself runs service-role and stays inside the confined reader.
    const sessions = await loadSurveyResponseSessions(
      createServiceRoleClient(),
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
        statusFilter,
        message: failure.message,
      });
      return NextResponse.json(failure.body, { status: failure.status });
    }

    const csv = buildSurveyRegisterCsv(
      sessions.rows,
      buildSurveyRegisterPreamble({
        campaignId: access.campaign.id,
        campaignTitle: access.campaign.title ?? "",
        exportedAt: new Date().toISOString(),
        rowCount: sessions.rows.length,
        statusFilter,
      })
    );

    audit.info("survey_export_completed", {
      userId: user.id,
      campaignId: access.campaign.id,
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
  } catch (error) {
    audit.error("survey_export_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error during survey export" }, { status: 500 });
  }
}
