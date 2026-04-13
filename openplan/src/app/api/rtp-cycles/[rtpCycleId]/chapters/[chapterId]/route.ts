import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { RTP_CHAPTER_STATUS_OPTIONS } from "@/lib/rtp/catalog";

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

const RTP_CHAPTER_STATUSES = RTP_CHAPTER_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];

const patchChapterSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: z.enum(RTP_CHAPTER_STATUSES).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    guidance: z.union([z.string().trim().max(4000), z.null()]).optional(),
    contentMarkdown: z.union([z.string().trim().max(40000), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ rtpCycleId: string; chapterId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.chapters.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle chapter id" }, { status: 400 });
    }

    const payload = patchChapterSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid RTP chapter update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: chapter, error: chapterError } = await supabase
      .from("rtp_cycle_chapters")
      .select("id, workspace_id, rtp_cycle_id")
      .eq("id", parsedParams.data.chapterId)
      .eq("rtp_cycle_id", parsedParams.data.rtpCycleId)
      .maybeSingle();

    if (chapterError) {
      audit.error("chapter_lookup_failed", { message: chapterError.message, code: chapterError.code ?? null });
      return NextResponse.json({ error: "Failed to load RTP chapter" }, { status: 500 });
    }
    if (!chapter) {
      return NextResponse.json({ error: "RTP chapter not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", chapter.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { message: membershipError.message, code: membershipError.code ?? null });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (payload.data.title !== undefined) updates.title = payload.data.title;
    if (payload.data.status !== undefined) updates.status = payload.data.status;
    if (payload.data.summary !== undefined) updates.summary = payload.data.summary;
    if (payload.data.guidance !== undefined) updates.guidance = payload.data.guidance;
    if (payload.data.contentMarkdown !== undefined) updates.content_markdown = payload.data.contentMarkdown;

    const { data: updatedChapter, error: updateError } = await supabase
      .from("rtp_cycle_chapters")
      .update(updates)
      .eq("id", chapter.id)
      .select("id, rtp_cycle_id, chapter_key, title, section_type, status, sort_order, required, guidance, summary, content_markdown, updated_at")
      .single();

    if (updateError) {
      audit.error("chapter_update_failed", { message: updateError.message, code: updateError.code ?? null });
      return NextResponse.json({ error: "Failed to update RTP chapter" }, { status: 500 });
    }

    audit.info("chapter_updated", {
      rtpCycleId: chapter.rtp_cycle_id,
      chapterId: chapter.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ chapter: updatedChapter });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update RTP chapter" }, { status: 500 });
  }
}
