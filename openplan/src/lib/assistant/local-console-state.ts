import { z } from "zod";
import type { AssistantPreview, AssistantResponse } from "@/lib/assistant/catalog";

export const assistantLocalConsoleFilterSchema = z.enum(["all", "act_now", "review_soon", "support_context"]);
export const assistantLocalConsoleViewModeSchema = z.enum(["full", "triage"]);

export const assistantLocalConsoleStateSchema = z.object({
  title: z.string().trim().max(160),
  detail: z.string().trim().max(600),
  shapedCount: z.number().int().min(0).max(500),
  snoozedCount: z.number().int().min(0).max(500),
  returningSoonCount: z.number().int().min(0).max(500),
  viewMode: assistantLocalConsoleViewModeSchema,
  filter: assistantLocalConsoleFilterSchema,
});

export type AssistantLocalConsoleFilter = z.infer<typeof assistantLocalConsoleFilterSchema>;
export type AssistantLocalConsoleViewMode = z.infer<typeof assistantLocalConsoleViewModeSchema>;
export type AssistantLocalConsoleState = z.infer<typeof assistantLocalConsoleStateSchema>;

function describeConsoleFilter(filter: AssistantLocalConsoleFilter): string {
  switch (filter) {
    case "act_now":
      return "act-now pressure";
    case "review_soon":
      return "review-soon work";
    case "support_context":
      return "support context";
    case "all":
    default:
      return "all operation groups";
  }
}

export function applyLocalConsoleStateToPreview(
  preview: AssistantPreview,
  localConsoleState?: AssistantLocalConsoleState | null
): AssistantPreview {
  if (!localConsoleState) return preview;

  return {
    ...preview,
    summary: `${preview.summary} Local board posture: ${localConsoleState.title}.`,
    facts: [
      `Local board cue: ${localConsoleState.detail}`,
      `Local board is filtered to ${describeConsoleFilter(localConsoleState.filter)} in ${localConsoleState.viewMode} mode, with ${localConsoleState.shapedCount} shaped operation${localConsoleState.shapedCount === 1 ? "" : "s"}.`,
      ...preview.facts,
    ],
  };
}

export function applyLocalConsoleStateToResponse(
  response: AssistantResponse,
  localConsoleState?: AssistantLocalConsoleState | null
): AssistantResponse {
  if (!localConsoleState) return response;

  return {
    ...response,
    summary: `${response.summary} Local board posture: ${localConsoleState.title}.`,
    findings: [`Local board cue: ${localConsoleState.detail}`, ...response.findings],
    evidence: [
      ...response.evidence,
      `Console mode: ${localConsoleState.viewMode}`,
      `Console filter: ${describeConsoleFilter(localConsoleState.filter)}`,
      `Local shaped ops: ${localConsoleState.shapedCount}`,
      `Local snoozed ops: ${localConsoleState.snoozedCount}`,
      `Returning soon: ${localConsoleState.returningSoonCount}`,
    ],
  };
}
