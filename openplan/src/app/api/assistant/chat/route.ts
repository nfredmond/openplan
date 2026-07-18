import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { loadAssistantContext } from "@/lib/assistant/context";
import { buildAssistantChatSystemPrompt } from "@/lib/assistant/chat-context";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";
import { checkAiUsageRateLimit } from "@/lib/billing/ai-rate-limit";

const ASSISTANT_CHAT_MAX_BODY_BYTES = BODY_LIMITS.normalJson;
const ASSISTANT_CHAT_DEFAULT_MODEL = "claude-opus-4-8";
const ASSISTANT_CHAT_MAX_OUTPUT_TOKENS = 2000;
const ASSISTANT_CHAT_MAX_HISTORY_ENTRIES = 12;

const historyEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

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
  question: z.string().trim().min(1).max(2000),
  history: z.array(historyEntrySchema).max(ASSISTANT_CHAT_MAX_HISTORY_ENTRIES).nullable().optional(),
});

function resolveAssistantChatModelId(): string {
  return process.env.OPENPLAN_ASSISTANT_MODEL?.trim() || ASSISTANT_CHAT_DEFAULT_MODEL;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.chat.post", request);
  const startedAt = Date.now();

  try {
    const bodyRead = await readJsonWithLimit(request, ASSISTANT_CHAT_MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      audit.warn("request_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes: ASSISTANT_CHAT_MAX_BODY_BYTES,
      });
      return bodyRead.response;
    }

    const parsed = requestSchema.safeParse(bodyRead.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid assistant chat request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      audit.warn("ai_offline", {
        kind: parsed.data.kind,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "ai_offline" }, { status: 503 });
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

    if (context.workspace.id) {
      const rateLimit = await checkAiUsageRateLimit(context.workspace.id);
      if (!rateLimit.allowed) {
        audit.warn("assistant_chat_rate_limited", {
          workspaceId: context.workspace.id,
          userId: user.id,
          recentCount: rateLimit.count,
        });
        return NextResponse.json(
          { error: "Too many AI requests in a short window. Please wait a moment and try again." },
          { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
        );
      }
    }

    const modelId = resolveAssistantChatModelId();
    const systemPrompt = buildAssistantChatSystemPrompt(context);
    // Drop any leading assistant turns so the forwarded conversation always
    // starts with a user message — the Messages API 400s otherwise, and a
    // dropped-reply history window can otherwise begin with an assistant entry.
    let history = parsed.data.history ?? [];
    while (history.length > 0 && history[0].role === "assistant") {
      history = history.slice(1);
    }

    if (context.workspace.id) {
      await recordUsageEventBestEffort(
        {
          workspaceId: context.workspace.id,
          eventKey: "assistant_chat",
          bucketKey: "assistant_chat",
          sourceRoute: "/api/assistant/chat",
          metadata: {
            kind: context.kind,
            model: modelId,
          },
        },
        audit
      );
    }

    const result = streamText({
      model: anthropic(modelId),
      system: systemPrompt,
      messages: [...history, { role: "user" as const, content: parsed.data.question }],
      maxOutputTokens: ASSISTANT_CHAT_MAX_OUTPUT_TOKENS,
      onError: ({ error }) => {
        audit.error("assistant_chat_stream_error", { error });
      },
      onFinish: ({ usage }) => {
        audit.info("assistant_chat_stream_finished", {
          kind: context.kind,
          workspaceId: context.workspace.id,
          userId: user.id,
          model: modelId,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          durationMs: Date.now() - startedAt,
        });
      },
    });

    audit.info("assistant_chat_stream_started", {
      kind: context.kind,
      workspaceId: context.workspace.id,
      userId: user.id,
      model: modelId,
      historyLength: history.length,
      durationMs: Date.now() - startedAt,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    audit.error("assistant_chat_unhandled_error", {
      error,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ error: "Unexpected error while streaming assistant chat reply" }, { status: 500 });
  }
}
