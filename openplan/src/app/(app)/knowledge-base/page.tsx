import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { KB_DOCUMENT_COLUMNS, type KbDocumentRow } from "@/lib/knowledge-base/documents";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";

export const metadata = {
  title: "Knowledge Base · OpenPlan",
};

export default async function KnowledgeBasePage() {
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
  const { data } = await supabase
    .from("kb_documents")
    .select(KB_DOCUMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <KnowledgeBaseWorkspace
      workspaceId={workspaceId}
      initialDocuments={(data ?? []) as KbDocumentRow[]}
    />
  );
}
