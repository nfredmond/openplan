export type PlanningContextProject = {
  id: string;
  name: string;
};

export type PlanningContext =
  | {
      status: "none";
      requestedProjectId: null;
      project: null;
    }
  | {
      status: "active";
      requestedProjectId: string;
      project: PlanningContextProject;
    }
  | {
      status: "rejected" | "unreadable";
      requestedProjectId: string;
      project: null;
    };

type PlanningContextQueryResult = {
  data: { id: string; name: string | null } | null;
  error: { message?: string | null } | null;
};

export type PlanningContextSupabaseLike = {
  from(table: "projects"): {
    select(columns: "id, name"): {
      eq(column: "workspace_id", value: string): {
        eq(column: "id", value: string): {
          maybeSingle(): Promise<PlanningContextQueryResult>;
        };
      };
    };
  };
};

/** First non-empty value of the repeatable `projectId` parameter. */
export function planningProjectId(
  value: string | string[] | null | undefined,
): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Keep creator defaults inside the project list already scoped to this workspace. */
export function selectInitialPlanningProjectId(
  projects: readonly { id: string }[],
  requested: string | null | undefined,
  fallback: "first" | "none",
): string {
  if (requested && projects.some((project) => project.id === requested)) return requested;
  return fallback === "first" ? projects[0]?.id ?? "" : "";
}

/**
 * Resolve a URL project only inside the active workspace.
 *
 * The query includes both predicates even though RLS also hides foreign rows.
 * Callers get one visible `rejected` state for a missing, deleted, or foreign
 * id, so the page neither leaks another workspace's project name nor silently
 * widens back to a workspace-wide catalog.
 */
export async function loadPlanningContext(
  supabase: PlanningContextSupabaseLike,
  workspaceId: string,
  requested: string | string[] | null | undefined,
): Promise<PlanningContext> {
  const requestedProjectId = planningProjectId(requested);
  if (!requestedProjectId) {
    return { status: "none", requestedProjectId: null, project: null };
  }

  const result = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("id", requestedProjectId)
    .maybeSingle();

  return resolvePlanningContext(requestedProjectId, result.data, result.error);
}

/** Resolve from a project row already read through a workspace-scoped query. */
export function resolvePlanningContext(
  requested: string | string[] | null | undefined,
  project: { id: string; name: string | null } | null | undefined,
  error?: { message?: string | null } | null,
): PlanningContext {
  const requestedProjectId = planningProjectId(requested);
  if (!requestedProjectId) {
    return { status: "none", requestedProjectId: null, project: null };
  }
  if (error) {
    return { status: "unreadable", requestedProjectId, project: null };
  }
  if (!project || project.id !== requestedProjectId) {
    return { status: "rejected", requestedProjectId, project: null };
  }

  return {
    status: "active",
    requestedProjectId,
    project: {
      id: project.id,
      name: project.name?.trim() || "Untitled project",
    },
  };
}

/**
 * Add project context without dropping an existing query string or fragment.
 * Grants may request its carried-forward `focusProjectId` spelling; every new
 * link uses `projectId`.
 */
export function withPlanningContext(
  href: string,
  projectId: string | null | undefined,
  options?: { parameter?: "projectId" | "focusProjectId" },
): string {
  const trimmedProjectId = projectId?.trim() ?? "";
  if (!trimmedProjectId) return href;

  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
  params.set(options?.parameter ?? "projectId", trimmedProjectId);
  return `${path}?${params.toString()}${hash}`;
}
