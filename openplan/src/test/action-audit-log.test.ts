import { describe, expect, it, vi } from "vitest";
import { recordAssistantActionExecution } from "@/lib/observability/action-audit";

describe("recordAssistantActionExecution", () => {
  it("writes one assistant_action_executions row per invocation (two execute actions → two rows)", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const insertMock = vi.fn((values: Record<string, unknown>) => {
      rows.push(values);
      return Promise.resolve({ error: null });
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "assistant_action_executions") {
          return {
            insert: insertMock,
          } as unknown as ReturnType<typeof Object>;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as Parameters<typeof recordAssistantActionExecution>[0];

    const firstResult = await recordAssistantActionExecution(supabase, {
      workspaceId: "workspace-1",
      userId: "user-1",
      actionKind: "create_rtp_packet_record",
      auditEvent: "planner_agent.create_rtp_packet_record",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "succeeded",
      inputSummary: { reportId: "report-1", rtpCycleId: "cycle-1" },
      startedAt: "2026-04-16T12:00:00.000Z",
      completedAt: "2026-04-16T12:00:02.000Z",
    });

    const secondResult = await recordAssistantActionExecution(supabase, {
      workspaceId: "workspace-1",
      userId: "user-1",
      actionKind: "generate_report_artifact",
      auditEvent: "planner_agent.generate_report_artifact",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "succeeded",
      inputSummary: { reportId: "report-1", artifactId: "artifact-1" },
      startedAt: "2026-04-16T12:00:05.000Z",
      completedAt: "2026-04-16T12:00:09.000Z",
    });

    expect(firstResult.error).toBeNull();
    expect(secondResult.error).toBeNull();
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      workspace_id: "workspace-1",
      user_id: "user-1",
      action_kind: "create_rtp_packet_record",
      audit_event: "planner_agent.create_rtp_packet_record",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "succeeded",
    });
    expect(rows[1]).toMatchObject({
      action_kind: "generate_report_artifact",
      input_summary: { reportId: "report-1", artifactId: "artifact-1" },
    });
  });

  it("returns the insert error if the audit write fails", async () => {
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({
          error: { message: "permission denied", code: "42501" },
        }),
      })),
    } as unknown as Parameters<typeof recordAssistantActionExecution>[0];

    const result = await recordAssistantActionExecution(supabase, {
      workspaceId: "workspace-1",
      userId: "user-1",
      actionKind: "generate_report_artifact",
      auditEvent: "planner_agent.generate_report_artifact",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "failed",
      errorMessage: "something went wrong",
      startedAt: "2026-04-16T12:00:00.000Z",
      completedAt: "2026-04-16T12:00:01.000Z",
    });

    expect(result.error).toEqual({ message: "permission denied", code: "42501" });
  });
});
