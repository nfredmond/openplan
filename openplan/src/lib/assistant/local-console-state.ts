import { z } from "zod";
import type { AssistantBoardStateCue, AssistantPreview, AssistantResponse } from "@/lib/assistant/catalog";

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
      return "what needs doing now";
    case "review_soon":
      return "work to review soon";
    case "support_context":
      return "background context";
    case "all":
    default:
      return "everything";
  }
}

function buildBoardStateCue(localConsoleState: AssistantLocalConsoleState): AssistantBoardStateCue {
  return {
    label: "How this panel is set up",
    title: localConsoleState.title,
    detail: localConsoleState.detail,
    items: [
      `View: ${localConsoleState.viewMode}`,
      `Filter: ${describeConsoleFilter(localConsoleState.filter)}`,
      `Pinned: ${localConsoleState.shapedCount}`,
      `Snoozed: ${localConsoleState.snoozedCount}`,
      `Coming back soon: ${localConsoleState.returningSoonCount}`,
    ],
  };
}

export function applyLocalConsoleStateToPreview(
  preview: AssistantPreview,
  localConsoleState?: AssistantLocalConsoleState | null
): AssistantPreview {
  if (!localConsoleState) return preview;

  return {
    ...preview,
    boardStateCue: buildBoardStateCue(localConsoleState),
  };
}

export function applyLocalConsoleStateToResponse(
  response: AssistantResponse,
  localConsoleState?: AssistantLocalConsoleState | null
): AssistantResponse {
  if (!localConsoleState) return response;

  return {
    ...response,
    boardStateCue: buildBoardStateCue(localConsoleState),
  };
}
