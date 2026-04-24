import { recordUsageEvent } from "@/lib/billing/usage-events";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type UsageRecordingAudit = {
  warn: (event: string, context?: Record<string, unknown>) => void;
};

function getMissingEnvironmentVariable(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    error.name === "MissingEnvironmentVariableError" &&
    "variableName" in error &&
    typeof error.variableName === "string"
  ) {
    return error.variableName;
  }

  return undefined;
}

export async function recordUsageEventBestEffort(
  input: {
    workspaceId: string;
    eventKey: string;
    bucketKey?: string;
    weight?: number;
    sourceRoute?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  audit?: UsageRecordingAudit
): Promise<void> {
  try {
    const serviceSupabase = createServiceRoleClient();
    const result = await recordUsageEvent(serviceSupabase, input);

    if (!result.ok) {
      audit?.warn("usage_event_record_failed", {
        workspaceId: input.workspaceId,
        eventKey: input.eventKey,
        sourceRoute: input.sourceRoute ?? null,
        message: result.error?.message ?? "unknown",
        code: result.error?.code ?? null,
        missingSchema: result.error?.missingSchema ?? false,
      });
    }
  } catch (error) {
    audit?.warn("usage_event_record_failed", {
      workspaceId: input.workspaceId,
      eventKey: input.eventKey,
      sourceRoute: input.sourceRoute ?? null,
      message: error instanceof Error ? error.message : "unknown",
      missingEnv: getMissingEnvironmentVariable(error),
    });
  }
}
