import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  APPLICATION_ATTACHMENT_SELECT,
  APPLICATION_PENDING_SCHEMA_ERROR,
  looksLikePendingAssemblySchema,
} from "@/lib/grants/application";

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

// Custom checklist items are first-class — a NOFO can require documents no
// template anticipated.
const createAttachmentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    attachmentKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "attachmentKey must be kebab-case")
      .max(120)
      .optional(),
    guidance: z.union([z.string().trim().max(4000), z.null()]).optional(),
    required: z.boolean().optional(),
  })
  .strict();

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

function slugifyKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "custom-attachment";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.attachments.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = createAttachmentSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid attachment payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;
    const attachmentKey = parsed.data.attachmentKey ?? slugifyKey(parsed.data.title);

    const { data: lastRows, error: lastError } = await supabase
      .from("funding_opportunity_attachments")
      .select("sort_order")
      .eq("opportunity_id", opportunity.id)
      .order("sort_order", { ascending: false })
      .limit(1);

    if (lastError) {
      if (looksLikePendingAssemblySchema(lastError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: "Failed to load attachments" }, { status: 500 });
    }

    const nextSortOrder =
      (((lastRows ?? []) as Array<{ sort_order: number }>)[0]?.sort_order ?? -1) + 1;

    const { data: attachment, error: insertError } = await supabase
      .from("funding_opportunity_attachments")
      .insert({
        workspace_id: opportunity.workspace_id,
        opportunity_id: opportunity.id,
        attachment_key: attachmentKey,
        title: parsed.data.title,
        guidance: parsed.data.guidance ?? null,
        required: parsed.data.required ?? false,
        status: "missing",
        sort_order: nextSortOrder,
        updated_by: user.id,
      })
      .select(APPLICATION_ATTACHMENT_SELECT)
      .single();

    if (insertError || !attachment) {
      const message = insertError?.message ?? "attachment_insert_returned_no_row";
      if (looksLikePendingAssemblySchema(message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      if (insertError?.code === "23505" || /duplicate key/i.test(message)) {
        return NextResponse.json(
          { error: `An attachment with the key "${attachmentKey}" already exists for this opportunity` },
          { status: 409 }
        );
      }
      audit.error("attachment_insert_failed", {
        opportunityId: opportunity.id,
        userId: user.id,
        message,
      });
      return NextResponse.json({ error: "Failed to create attachment" }, { status: 500 });
    }

    audit.info("attachment_created", {
      opportunityId: opportunity.id,
      workspaceId: opportunity.workspace_id,
      userId: user.id,
      attachmentKey,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    audit.error("attachment_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating attachment" }, { status: 500 });
  }
}
