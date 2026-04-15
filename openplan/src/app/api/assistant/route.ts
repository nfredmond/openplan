import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadAssistantContext } from "@/lib/assistant/context";
import { assistantLocalConsoleStateSchema } from "@/lib/assistant/local-console-state";
import { buildAssistantResponse } from "@/lib/assistant/respond";
import { resolveAssistantWorkflowId } from "@/lib/assistant/catalog";

const requestSchema = z.object({
  kind: z.enum([
    "workspace",
    "analysis_studio",
    "project",
    "rtp_registry",
    "rtp_cycle",
    "plan",
    "program",
    "scenario_set",
    "model",
    "report",
    "rtp_packet_report",
    "run",
  ]),
  id: z.string().uuid().nullable().optional(),
  workspaceId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  baselineRunId: z.string().uuid().nullable().optional(),
  workflowId: z.string().min(1).max(80).nullable().optional(),
  question: z.string().trim().max(1200).nullable().optional(),
  localConsoleState: assistantLocalConsoleStateSchema.nullable().optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.post", request);
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid assistant request" }, { status: 400 });
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

    const workflowId = resolveAssistantWorkflowId(context.kind, parsed.data.workflowId, parsed.data.question);
    const response = buildAssistantResponse(context, workflowId, parsed.data.question, parsed.data.localConsoleState ?? null);

    audit.info("assistant_response_built", {
      kind: context.kind,
      workflowId,
      resourceId: target.id,
      workspaceId: context.workspace.id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ response, contextKind: context.kind }, { status: 200 });
  } catch (error) {
    audit.error("assistant_post_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ error: "Unexpected error while building assistant response" }, { status: 500 });
  }
}
