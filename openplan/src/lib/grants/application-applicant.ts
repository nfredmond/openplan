/**
 * Who the packaged application is for, as the product knows it: the linked
 * project and the workspace it was prepared in. The cover prints both, so a
 * reader sees on page 1 whose work this is (the first proven job's SS4A
 * covers named no applicant; KI-2026-11-14-304).
 *
 * These are the records' own names. They are not a legal applicant, which is
 * the agency's to state in its own sections.
 */

export type ApplicantName = { status: "named"; name: string } | { status: "not_linked" } | { status: "unread" };

export type ApplicationApplicant = { project: ApplicantName; workspace: ApplicantName };

type NameQuery = {
  from(table: "workspaces" | "projects"): {
    select(columns: "name"): {
      eq(column: string, value: string): NameFilter;
    };
  };
};
type NameFilter = {
  eq(column: string, value: string): NameFilter;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

function named(value: unknown): ApplicantName {
  const name = (value as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? { status: "named", name: name.trim() } : { status: "unread" };
}

async function readName(read: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<ApplicantName> {
  try {
    const { data, error } = await read();
    return error ? { status: "unread" } : named(data);
  } catch {
    return { status: "unread" };
  }
}

/**
 * Read the workspace's name, and the project's unless the caller already has
 * it (`projectName`: a name, null for no linked project, undefined to read).
 * A failed read is "unread", never a guessed name and never "not linked".
 */
export async function loadApplicationApplicant(
  supabase: unknown,
  input: { workspaceId: string; projectId: string | null; projectName?: string | null }
): Promise<ApplicationApplicant> {
  const client = supabase as NameQuery;
  const workspace = readName(() => client.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle());
  const project: Promise<ApplicantName> = !input.projectId
    ? Promise.resolve({ status: "not_linked" })
    : input.projectName
      ? Promise.resolve({ status: "named", name: input.projectName })
      : readName(() => client.from("projects").select("name").eq("id", input.projectId!).eq("workspace_id", input.workspaceId).maybeSingle());
  return { workspace: await workspace, project: await project };
}

/** The cover's words for one name. */
export function applicantNameLabel(name: ApplicantName): string {
  if (name.status === "named") return name.name;
  return name.status === "not_linked" ? "No project linked" : "Could not be read";
}
