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

/**
 * The planner-facing name of a console filter — ONE definition, deliberately
 * exported.
 *
 * It was written twice: here as a switch, and again in `app-copilot.tsx` as an
 * inline ternary chain. The two had already drifted once and were only brought
 * back into agreement by a copy pass on 2026-08-10. That is the shape CLAUDE.md
 * warns about — a shared capability living inside one of its callers gets
 * reimplemented by the other — and the second copy is the one a planner reads,
 * because it names the filter in the sentence offering to widen the view.
 *
 * Guarded by `src/test/one-name-for-a-console-filter.test.ts`.
 */
export function describeConsoleFilter(filter: AssistantLocalConsoleFilter): string {
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
