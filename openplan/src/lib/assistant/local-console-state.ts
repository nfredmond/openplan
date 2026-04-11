import { z } from "zod";

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

