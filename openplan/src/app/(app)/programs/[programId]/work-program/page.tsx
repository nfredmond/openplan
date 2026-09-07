import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadProgramAccess } from "@/lib/programs/api";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadWorkProgramPreparation } from "@/lib/programs/work-program/server";
import { WorkProgramEditor } from "@/components/programs/work-program/editor";

export default async function WorkProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadProgramAccess(supabase, programId, user.id, "programs.read");
  if (access.error) return <p role="alert">Program access could not be checked. Reload when the connection recovers.</p>;
  if (!access.program || !access.allowed || !access.membership) notFound();
  try {
    const preparation = await loadWorkProgramPreparation(supabase, programId);
    const documents: { id: string; title: string }[] = [];
    const evidenceDocuments: { id: string; title: string }[] = [];
    const projects: { id: string; name: string }[] = [];
    for (let offset = 0; ; offset += 100) {
      const result = await supabase.from("kb_documents").select("id, title, source_kind, checksum, storage_ref").eq("workspace_id", access.program.workspace_id).order("id").range(offset, offset + 99);
      if (result.error) throw new Error("Documents could not be loaded");
      documents.push(...(result.data ?? []).filter(row => row.source_kind === "uploaded_pdf"));
      evidenceDocuments.push(...(result.data ?? []).filter(row => row.checksum && row.storage_ref));
      if ((result.data?.length ?? 0) < 100) break;
    }
    for (let offset = 0; ; offset += 100) {
      const result = await supabase.from("projects").select("id, name").eq("workspace_id", access.program.workspace_id).order("id").range(offset, offset + 99);
      if (result.error) throw new Error("Projects could not be loaded");
      projects.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < 100) break;
    }
    const staff = await supabase.from("invoicing_staff").select("id, name").eq("workspace_id", access.program.workspace_id).order("name");
    const contracts = await supabase.from("invoicing_engagements").select("id, title").eq("workspace_id", access.program.workspace_id).order("title");
    if (staff.error || contracts.error) throw new Error("Staff and contracts could not be read");
    return <section className="space-y-6 min-w-0">
      <Link href={`/programs/${programId}`} className="underline">Back to {access.program.title}</Link>
      <header><h1 className="text-3xl font-semibold">Work program preparation</h1><p className="mt-2 text-muted-foreground">Prepare an OWP, UPWP or agency work program from retained sources. Link proposed narrative, funding and staffing to the retained originals.</p></header>
      <WorkProgramEditor programId={programId} workspaceId={access.program.workspace_id} userId={user.id} agency={access.program.sponsor_agency ?? ""} initial={preparation} documents={documents} evidenceDocuments={evidenceDocuments} projects={projects} staff={(staff.data ?? []).map((row) => ({ value: row.id, label: row.name }))} contracts={(contracts.data ?? []).map((row) => ({ value: row.id, label: row.title }))} canWrite={canAccessWorkspaceAction("programs.write", access.membership.role)} />
    </section>;
  } catch {
    return <section className="space-y-4"><Link href={`/programs/${programId}`} className="underline">Back to program</Link><p role="alert">The work program could not be loaded. Check Workspace setup &amp; health and retry. Your saved proposal is unchanged.</p></section>;
  }
}
