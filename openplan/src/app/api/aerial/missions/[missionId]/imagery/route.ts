/**
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-11, and
 * recorded executably in `src/test/refused-aerial-actions-stay-refused.test.ts`.
 *
 * Uploading mission imagery is a HUMAN CONSOLE WRITE, not a candidate for a
 * `propose_*` tool: the consequential content is megabytes of binary photo
 * evidence a model would author from OUTSIDE the system — the offline
 * comment-import refusal wearing wings, at 64 MiB per file instead of 4 MB —
 * and no approval sheet can render what a planner would be consenting to. The
 * photos are also the source evidence every processed output (orthomosaic,
 * DSM, point cloud) derives from, so a fabricated frame would sit invisibly
 * UNDER later deliverables. Every registered action's consequential payload is
 * an id verified against a workspace row or an enum; bytes are neither.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { AERIAL_IMAGERY_COLUMNS, resolveAerialImageMaxBytes } from "@/lib/aerial/imagery";
import {
  aerialImageTooLargeResponse,
  resolveAerialMissionAccess,
  storeAerialImage,
} from "@/lib/aerial/imagery-intake";

// Photos are streamed and hashed inline; allow more than the default budget.
export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({
  missionId: z.string().uuid(),
});

const uploadQuerySchema = z.object({
  filename: z.string().trim().min(1).max(255),
});

type RouteContext = { params: Promise<{ missionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.list", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const access = await resolveAerialMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;

    // User client on purpose: the member SELECT policy is a second net under
    // the explicit membership check above.
    const supabase = await createClient();
    const { data: rows, error: listError } = await supabase
      .from("aerial_imagery")
      .select(AERIAL_IMAGERY_COLUMNS)
      .eq("mission_id", access.mission.id)
      .order("created_at", { ascending: true });

    if (listError) {
      // A failed read is a failure, never an empty photo list.
      audit.error("aerial_imagery_list_failed", {
        missionId: access.mission.id,
        message: listError.message,
      });
      return NextResponse.json({ error: "Failed to load mission imagery" }, { status: 500 });
    }

    audit.info("aerial_imagery_listed", {
      missionId: access.mission.id,
      userId: access.userId,
      count: rows?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ imagery: rows ?? [] });
  } catch (error) {
    audit.error("aerial_imagery_list_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading mission imagery" }, { status: 500 });
  }
}

/**
 * One photo as the request body. On the hosted site a body above about 4.5 MB
 * never arrives (KI-2026-10-12-017), so the mission page stages photos through
 * `./upload/start` and `./upload/complete` instead; this door stays for API
 * clients and installs without that platform limit. Both doors end in the same
 * `storeAerialImage`.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("aerial-imagery.upload", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid mission id" }, { status: 400 });
    }

    const query = uploadQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "State the photo's filename in the `filename` query parameter." },
        { status: 400 }
      );
    }

    const access = await resolveAerialMissionAccess(parsedParams.data.missionId, audit);
    if (!access.ok) return access.response;
    if (isReadOnlyWorkspaceRole(access.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    // The ceiling is the operator's, resolved per request so raising the env
    // takes effect without a redeploy of anything but the process env.
    const maxBytes = resolveAerialImageMaxBytes();
    const bodyRead = await readBytesWithLimitStreaming(request, maxBytes);
    if (!bodyRead.ok) {
      audit.warn("aerial_image_too_large", { byteLength: bodyRead.byteLength, maxBytes });
      return aerialImageTooLargeResponse(maxBytes);
    }

    return await storeAerialImage({
      service: createServiceRoleClient(),
      mission: access.mission,
      userId: access.userId,
      filename: query.data.filename,
      bytes: bodyRead.bytes,
      audit,
      startedAt,
    });
  } catch (error) {
    audit.error("aerial_imagery_upload_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while storing the photo" }, { status: 500 });
  }
}
