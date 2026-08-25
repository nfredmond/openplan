import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

export const DEFAULT_REMINDER_ADVANCE_DAYS = 7;
export const MIN_REMINDER_ADVANCE_DAYS = 1;
export const MAX_REMINDER_ADVANCE_DAYS = 30;

export type WorkspaceReminderPreference = {
  workspaceId: string;
  advanceDays: number;
  emailDigestEnabled: boolean;
};

export const DEFAULT_REMINDER_PREFERENCE: Omit<WorkspaceReminderPreference, "workspaceId"> = {
  advanceDays: DEFAULT_REMINDER_ADVANCE_DAYS,
  emailDigestEnabled: true,
};

export function parseReminderPreference(
  row: Record<string, unknown> | null | undefined,
  workspaceId: string
): WorkspaceReminderPreference {
  const advance = Number(row?.advance_days);
  return {
    workspaceId,
    advanceDays:
      Number.isInteger(advance) && advance >= MIN_REMINDER_ADVANCE_DAYS && advance <= MAX_REMINDER_ADVANCE_DAYS
        ? advance
        : DEFAULT_REMINDER_ADVANCE_DAYS,
    emailDigestEnabled:
      typeof row?.email_digest_enabled === "boolean"
        ? row.email_digest_enabled
        : DEFAULT_REMINDER_PREFERENCE.emailDigestEnabled,
  };
}

type PreferenceClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
};

export async function loadWorkspaceReminderPreference(
  supabase: unknown,
  workspaceId: string
): Promise<{ preference: WorkspaceReminderPreference; pending: boolean; error: string | null }> {
  try {
    const { data, error } = await (supabase as PreferenceClient)
      .from("workspace_reminder_preferences")
      .select("advance_days, email_digest_enabled")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      return {
        preference: parseReminderPreference(null, workspaceId),
        pending: looksLikePendingSchema(error.message),
        error: error.message,
      };
    }
    return { preference: parseReminderPreference(data, workspaceId), pending: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder preference read failed";
    return {
      preference: parseReminderPreference(null, workspaceId),
      pending: looksLikePendingSchema(message),
      error: message,
    };
  }
}
