import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  COMMENT_IMPORT_MAX_ROWS,
  commentImportProvenance,
  isImportableSourceType,
  parseCommentImportCsv,
  IMPORTABLE_SOURCE_TYPES,
} from "@/lib/engagement/comment-import";

export const runtime = "nodejs";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const importSchema = z.object({
  csv: z.string().min(1).max(4_000_000),
  sourceType: z.string().refine(isImportableSourceType, {
    message: `sourceType must be one of ${IMPORTABLE_SOURCE_TYPES.join(", ")}`,
  }),
  fileName: z.string().trim().max(260).optional(),
  /**
   * FALSE parses and reports; TRUE parses and writes.
   *
   * One code path produces the preview and the insert, deliberately. If the
   * preview came from separate logic, an operator would be approving the output
   * of code that is not the code that runs — which is the same property
   * `assistant_action_approvals` hashes its inputs to guarantee.
   */
  commit: z.boolean().default(false),
});

type RouteContext = { params: Promise<{ campaignId: string }> };

/**
 * BULK IMPORT OF COMMENT THAT DID NOT ARRIVE THROUGH THE PORTAL.
 *
 * A consultation is the open house, the comment cards, the project inbox and the
 * council transcript, and then the portal. `source_type` has carried `meeting`
 * and `email` since the table was created and nothing ever offered a way to
 * enter them, so an agency's in-person turnout never reached the analysis that
 * claims to describe its outreach — biased in a predictable direction, since
 * portal submissions skew toward people with a device, a data plan and enough
 * English or Spanish to use it.
 *
 * EVERY IMPORTED COMMENT IS `pending`. There is no column and no field that can
 * change that. A file is not a review: it may hold transcription errors, a phone
 * number somebody wrote in the comment box, or a duplicate of what is already
 * there. An import that could write `approved` would be a way to put unmoderated
 * text on a public portal by uploading it.
 *
 * `public` CANNOT BE IMPORTED — see `isImportableSourceType`. That value means a
 * member of the public submitted through the portal under a rate limit, a
 * honeypot and a share token, none of which a spreadsheet row has. Allowing it
 * would let operator access manufacture public support that every downstream
 * count then treats as genuine.
 *
 * ALL OR NOTHING. A file with any invalid row is refused whole, and the insert
 * is a single array insert so a database error leaves nothing behind. Importing
 * the valid rows and reporting the rest leaves a campaign in a state neither the
 * operator nor the file describes, and re-uploading the corrected file then
 * duplicates everything that worked the first time.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.items.import", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.commentImportJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = importSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      // The CSV itself never reaches the audit trail: it is resident comment,
      // often with names in it.
      audit.warn("import_validation_failed", { issues: parsed.error.issues.length });
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid import payload" },
        { status: 400 }
      );
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
      "engagement.write"
    );
    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    }
    if (!access.campaign) {
      return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const parseResult = parseCommentImportCsv(parsed.data.csv);

    // Categories are matched by LABEL because that is what a spreadsheet holds.
    // Matching is case-insensitive and scoped to this campaign; an unmatched
    // label is reported, never quietly dropped, because a comment that lost its
    // topic on the way in looks like a successful import.
    const { data: categoryRows, error: categoryError } = await supabase
      .from("engagement_categories")
      .select("id, label")
      .eq("campaign_id", access.campaign.id);

    if (categoryError) {
      audit.error("import_category_lookup_failed", {
        campaignId: access.campaign.id,
        message: categoryError.message,
      });
      return NextResponse.json({ error: "Failed to read this campaign's categories" }, { status: 500 });
    }

    const categoryByLabel = new Map(
      ((categoryRows ?? []) as Array<{ id: string; label: string | null }>)
        .filter((row) => row.label)
        .map((row) => [row.label!.trim().toLowerCase(), row.id])
    );

    const errors = [...parseResult.errors];
    const unmatchedCategories = new Set<string>();
    for (const row of parseResult.rows) {
      if (row.categoryLabel && !categoryByLabel.has(row.categoryLabel.toLowerCase())) {
        unmatchedCategories.add(row.categoryLabel);
        errors.push({
          rowNumber: row.rowNumber,
          column: "category",
          message: `“${row.categoryLabel}” is not a category on this campaign. Create it first, or clear the cell.`,
        });
      }
    }

    const preview = {
      rowCount: parseResult.rows.length,
      errorCount: errors.length,
      errors: errors.slice(0, 200),
      headers: parseResult.headers,
      recognized: parseResult.recognized,
      ignored: parseResult.ignored,
      unmatchedCategories: [...unmatchedCategories],
      geolocatedCount: parseResult.rows.filter((row) => row.latitude !== null).length,
      maxRows: COMMENT_IMPORT_MAX_ROWS,
      // Said in the response rather than only in the UI, so any caller — a
      // script, a future agent — is told the same thing an operator is.
      importedStatus: "pending" as const,
    };

    if (errors.length > 0 || !parsed.data.commit) {
      return NextResponse.json(
        { ...preview, committed: false, importedCount: 0 },
        { status: errors.length > 0 && parsed.data.commit ? 400 : 200 }
      );
    }

    if (parseResult.rows.length === 0) {
      return NextResponse.json(
        { ...preview, committed: false, importedCount: 0, error: "This file has no comments in it." },
        { status: 400 }
      );
    }

    const batchId = randomUUID();
    const importedAt = new Date().toISOString();

    const { data: inserted, error: insertError } = await supabase
      .from("engagement_items")
      .insert(
        parseResult.rows.map((row) => ({
          campaign_id: access.campaign!.id,
          category_id: row.categoryLabel
            ? (categoryByLabel.get(row.categoryLabel.toLowerCase()) ?? null)
            : null,
          title: row.title,
          body: row.body,
          submitted_by: row.submittedBy,
          // Not negotiable, and not a default that a payload can override.
          status: "pending" as const,
          source_type: parsed.data.sourceType,
          latitude: row.latitude,
          longitude: row.longitude,
          metadata_json: commentImportProvenance({
            batchId,
            fileName: parsed.data.fileName ?? null,
            rowNumber: row.rowNumber,
            importedAt,
          }),
          created_by: user.id,
        }))
      )
      .select("id");

    if (insertError) {
      audit.error("import_insert_failed", {
        campaignId: access.campaign.id,
        batchId,
        rowCount: parseResult.rows.length,
        message: insertError.message,
        code: insertError.code ?? null,
      });
      return NextResponse.json(
        { error: "Failed to import these comments. Nothing was saved." },
        { status: 500 }
      );
    }

    audit.info("engagement_comments_imported", {
      campaignId: access.campaign.id,
      batchId,
      sourceType: parsed.data.sourceType,
      importedCount: (inserted ?? []).length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { ...preview, committed: true, importedCount: (inserted ?? []).length, batchId },
      { status: 201 }
    );
  } catch (error) {
    audit.error("import_unhandled", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Unexpected error while importing comments" }, { status: 500 });
  }
}
