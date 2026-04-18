import { describe, expect, it, vi } from "vitest";
import { withAssistantActionAudit } from "@/lib/observability/action-audit";
import { ACTION_REGISTRY } from "@/lib/runtime/action-registry";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

type InsertedRow = Record<string, unknown>;

function makeCapturingClient(overrides?: { insertError?: null | { message: string; code?: string } }) {
  const inserts: InsertedRow[] = [];
  const insertMock = vi.fn(async (row: InsertedRow) => {
    inserts.push(row);
    return { error: overrides?.insertError ?? null };
  });
  const fromMock = vi.fn((table: string) => {
    if (table !== "assistant_action_executions") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return { insert: insertMock };
  });
  return { inserts, insertMock, from: fromMock } as const;
}

const ACTION_KINDS = Object.keys(ACTION_REGISTRY) as AssistantQuickLinkExecuteAction["kind"][];

describe("withAssistantActionAudit (live-loop proof)", () => {
  it("registry covers all 7 ActionRecord kinds", () => {
    expect(ACTION_KINDS).toHaveLength(7);
    expect(new Set(ACTION_KINDS)).toEqual(
      new Set([
        "generate_report_artifact",
        "create_rtp_packet_record",
        "create_funding_opportunity",
        "create_project_funding_profile",
        "update_funding_opportunity_decision",
        "link_billing_invoice_funding_award",
        "create_project_record",
      ])
    );
  });

  for (const kind of [
    "generate_report_artifact",
    "create_rtp_packet_record",
    "create_funding_opportunity",
    "create_project_funding_profile",
    "update_funding_opportunity_decision",
    "link_billing_invoice_funding_award",
    "create_project_record",
  ] as const) {
    const record = ACTION_REGISTRY[kind];

    it(`writes a succeeded row for ${kind} with registry-driven fields`, async () => {
      const client = makeCapturingClient();
      const result = await withAssistantActionAudit(
        { from: client.from } as never,
        {
          actionKind: kind,
          workspaceId: "w-1",
          userId: "u-1",
          inputSummary: { probe: kind },
        },
        async () => `ok:${kind}`
      );

      expect(result).toBe(`ok:${kind}`);
      expect(client.inserts).toHaveLength(1);
      const row = client.inserts[0];
      expect(row).toMatchObject({
        workspace_id: "w-1",
        user_id: "u-1",
        action_kind: kind,
        audit_event: record.auditEvent,
        approval: record.approval,
        regrounding: record.regrounding,
        outcome: "succeeded",
        error_message: null,
        input_summary: { probe: kind },
      });
      expect(typeof row.started_at).toBe("string");
      expect(typeof row.completed_at).toBe("string");
    });

    it(`writes a failed row for ${kind} when the body throws`, async () => {
      const client = makeCapturingClient();
      await expect(
        withAssistantActionAudit(
          { from: client.from } as never,
          {
            actionKind: kind,
            workspaceId: "w-1",
            userId: "u-1",
            inputSummary: { probe: kind },
          },
          async () => {
            throw new Error(`boom:${kind}`);
          }
        )
      ).rejects.toThrow(`boom:${kind}`);

      expect(client.inserts).toHaveLength(1);
      expect(client.inserts[0]).toMatchObject({
        action_kind: kind,
        audit_event: record.auditEvent,
        approval: record.approval,
        regrounding: record.regrounding,
        outcome: "failed",
        error_message: `boom:${kind}`,
        input_summary: { probe: kind },
      });
    });
  }

  it("does not mask body result when the audit insert itself fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeCapturingClient({
      insertError: { message: "rls_denied", code: "42501" },
    });
    const result = await withAssistantActionAudit(
      { from: client.from } as never,
      {
        actionKind: "create_funding_opportunity",
        workspaceId: "w-1",
        userId: "u-1",
      },
      async () => "still-returned"
    );
    expect(result).toBe("still-returned");
    expect(warnSpy).toHaveBeenCalledWith(
      "[action-audit] succeeded-row insert failed",
      expect.objectContaining({ actionKind: "create_funding_opportunity", message: "rls_denied" })
    );
    warnSpy.mockRestore();
  });
});
