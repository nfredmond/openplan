import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { KB_DOCUMENT_COLUMNS, type KbDocumentRow } from "@/lib/knowledge-base/documents";
import {
  KnowledgeBaseWorkspace,
  type KnowledgeBaseProjectOption,
} from "@/components/knowledge-base/knowledge-base-workspace";

import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Knowledge Base");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams?: Promise<{ projectId?: string | string[] }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
  }

  const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership) {
    return (
      <section className="module-page">
        <div className="module-intro-card">
          <h1 className="module-section-title">Workspace access required</h1>
          <p className="module-note">
            You need to belong to a workspace to manage its Knowledge Base — the place to upload your
            agency&apos;s plans, comment letters, prior studies, and grant notices so the Planner Agent
            and Grant Writer can ground and cite from them.
          </p>
          <div className="module-inline-list">
            <Link className="module-inline-item" href="/projects">
              Projects
            </Link>
            <Link className="module-inline-item" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const workspaceId = membership.workspace_id;

  // The workspace's projects power the attach-on-upload selector and the
  // per-project filter. Documents stay readable even if this read fails —
  // the component simply renders without a selector.
  const projectsResult = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(200);
  const projects = (projectsResult.data ?? []) as KnowledgeBaseProjectOption[];

  // ?projectId= is the deep-link entry from a project's control room. It is
  // honored only when it names one of THIS workspace's projects — a foreign or
  // malformed id silently falls back to the unfiltered view rather than
  // presenting an empty list as "this project has no documents".
  const rawParams = (await searchParams) ?? {};
  const requestedProjectId = Array.isArray(rawParams.projectId)
    ? rawParams.projectId[0]
    : rawParams.projectId;
  const initialProjectId =
    requestedProjectId &&
    UUID_PATTERN.test(requestedProjectId) &&
    projects.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : null;

  let documentsQuery = supabase
    .from("kb_documents")
    .select(KB_DOCUMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (initialProjectId) {
    documentsQuery = documentsQuery.eq("project_id", initialProjectId);
  }
  // "No documents yet" is a claim about this workspace's corpus. A failed read
  // cannot make it — and here it invites a planner to re-upload a plan the
  // workspace already holds.
  const documentsResult = await documentsQuery;

  return (
    <KnowledgeBaseWorkspace
      workspaceId={workspaceId}
      initialDocuments={(documentsResult.data ?? []) as KbDocumentRow[]}
      projects={projects}
      initialProjectId={initialProjectId}
      readFailures={{
        documents: Boolean(documentsResult.error),
        projects: Boolean(projectsResult.error),
      }}
    />
  );
}
