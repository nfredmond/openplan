/**
 * Keeps a project embedded in an RTP link row inside the plan's workspace.
 *
 * The public plan pages read `project_rtp_cycle_links` with the service-role
 * client and embed `projects(...)`. Filtering the link row on the cycle's
 * workspace keeps a link forged against this cycle off the page, but the embed
 * still returns whatever project the row names, in any workspace. Until the
 * database refuses such a row (KI-2026-11-02-053, migration 20261102140000),
 * a page that publishes link rows drops every row whose embedded project
 * belongs to another workspace, or whose workspace was not read at all.
 *
 * A row whose embed came back empty is kept: it carries no project data, and
 * each page already reports it as an unreadable project.
 */

type EmbeddedProject = { workspace_id?: string | null };

function unwrapProject(value: unknown): EmbeddedProject | null {
  const project = Array.isArray(value) ? value[0] : value;
  return project && typeof project === "object" ? (project as EmbeddedProject) : null;
}

export function keepLinksInsideWorkspace<T extends { projects: unknown }>(
  rows: readonly T[],
  workspaceId: string
): { rows: T[]; dropped: number } {
  const kept = rows.filter((row) => {
    const project = unwrapProject(row.projects);
    return project === null || (typeof project.workspace_id === "string" && project.workspace_id === workspaceId);
  });
  return { rows: kept, dropped: rows.length - kept.length };
}
