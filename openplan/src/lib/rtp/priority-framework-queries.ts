/**
 * Loading the RTP priority framework binding for a workspace.
 *
 * This lives in one place on purpose. Four surfaces need it — the cycle page,
 * the public share page, the export route and the report-generate route — and
 * a shared capability that lives inside one of its callers gets reimplemented
 * wrongly by the next one. The specific way it would be reimplemented wrongly
 * is already known: `HOME_GEOGRAPHY_SCOPE_COLUMNS` omits
 * `home_subdivision_code`, so selecting with it makes `resolveJurisdiction`
 * report every workspace as subdivision-unknown, and a California agency is
 * told no framework covers it while California's sits in the registry. This
 * module selects `HOME_GEOGRAPHY_COLUMNS`, which includes it.
 */
import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import {
  resolveRtpPriorityFrameworkForWorkspace,
  type RtpPriorityFrameworkBinding,
} from "./priority-framework-binding";
import type { RtpPriorityFrameworkRegistry } from "./priority-frameworks";

/** The projection any surface must select before resolving a binding. */
export const RTP_PRIORITY_FRAMEWORK_WORKSPACE_COLUMNS = HOME_GEOGRAPHY_COLUMNS;

type WorkspaceRowResult = { data: unknown; error: { message?: string | null } | null };

export interface RtpPriorityFrameworkQuerySupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<WorkspaceRowResult>;
      };
    };
  };
}

export interface RtpPriorityFrameworkLoadResult {
  binding: RtpPriorityFrameworkBinding;
  /**
   * The raw workspace read, so a page can pass it straight to
   * `ReadFailureLog.check` and disclose the failure in its own words rather
   * than reconstructing a synthetic result.
   */
  result: WorkspaceRowResult;
  /**
   * True when the workspace row could not be read. The binding is still a
   * valid uncited binding, but the caller must disclose the failure rather
   * than present "cites no policy basis" as a settled fact — the workspace may
   * well have a jurisdiction we simply could not see.
   */
  readFailed: boolean;
}

export async function loadRtpPriorityFrameworkBinding(
  supabase: RtpPriorityFrameworkQuerySupabaseLike,
  workspaceId: string,
  options?: { requestedFrameworkId?: string | null; registry?: RtpPriorityFrameworkRegistry }
): Promise<RtpPriorityFrameworkLoadResult> {
  const result = await supabase
    .from("workspaces")
    .select(RTP_PRIORITY_FRAMEWORK_WORKSPACE_COLUMNS)
    .eq("id", workspaceId)
    .maybeSingle();

  if (result.error) {
    return {
      binding: resolveRtpPriorityFrameworkForWorkspace(null, options),
      result,
      readFailed: true,
    };
  }

  return {
    binding: resolveRtpPriorityFrameworkForWorkspace(parseWorkspaceHomeGeography(result.data), options),
    result,
    readFailed: false,
  };
}
