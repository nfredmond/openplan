import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { buildAssistantPreview } from "@/lib/assistant/respond";
import type { AssistantTargetKind } from "@/lib/assistant/catalog";
import { loadAssistantContext } from "@/lib/assistant/context";

const querySchema = z.object({
  kind: z.enum(["workspace", "analysis_studio", "project", "scenario_set", "model", "report", "run"]),
  id: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  baselineRunId: z.string().uuid().nullable().optional(),
});

function asNullableUuid(value: string | null) {
  return value ?? null;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.context.get", request);
  const startedAt = Date.now();

  try {
    const parsed = querySchema.safeParse({
      kind: request.nextUrl.searchParams.get("kind") as AssistantTargetKind | null,
      id: asNullableUuid(request.nextUrl.searchParams.get("id")),
      workspaceId: asNullableUuid(request.nextUrl.searchParams.get("workspaceId")),
      runId: asNullableUuid(request.nextUrl.searchParams.get("runId")),
      baselineRunId: asNullableUuid(request.nextUrl.searchParams.get("baselineRunId")),
    });

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid assistant context query" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const target = {
      kind: parsed.data.kind,
      id: parsed.data.id ?? parsed.data.runId ?? null,
      workspaceId: parsed.data.workspaceId ?? null,
      runId: parsed.data.runId ?? null,
      baselineRunId: parsed.data.baselineRunId ?? null,
    };

    const context = await loadAssistantContext(supabase, user.id, target);

    if (!context) {
      audit.warn("context_not_found", {
        kind: target.kind,
        resourceId: target.id,
        workspaceId: target.workspaceId,
        userId: user.id,
      });
      return NextResponse.json({ error: "Assistant context not found" }, { status: 404 });
    }

    const preview = buildAssistantPreview(context);

    audit.info("context_loaded", {
      kind: context.kind,
      resourceId: target.id,
      workspaceId: context.workspace.id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ preview, contextKind: context.kind }, { status: 200 });
  } catch (error) {
    audit.error("assistant_context_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ error: "Unexpected error while loading assistant context" }, { status: 500 });
  }
}
