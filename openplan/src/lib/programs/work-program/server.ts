import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadProgramAccess } from "@/lib/programs/api";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import type { WorkProgramPreparation, WorkProgramRevision, WorkProgramSource } from "./types";

export async function authorizeWorkProgram(request: NextRequest, programId: string, write: boolean) {
  if (!z.string().uuid().safeParse(programId).success) return { response: NextResponse.json({ error: "Invalid program identifier" }, { status: 400 }) };
  if (write && readAssistantExecutionSource(request) !== "manual") return { response: NextResponse.json({ error: "Work-program preparation is not a registered Planner Agent action. Open the program to review and save the proposal." }, { status: 403 }) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await loadProgramAccess(supabase, programId, user.id, write ? "programs.write" : "programs.read");
  if (access.error) return { response: NextResponse.json({ error: "Could not verify program access" }, { status: 503 }) };
  if (!access.program || !access.membership) return { response: NextResponse.json({ error: "Program not found" }, { status: 404 }) };
  if (!access.allowed) return { response: NextResponse.json({ error: "Your role cannot change this program" }, { status: 403 }) };
  return { supabase, user, program: access.program };
}

const sourceColumns = "id, document_id, document_checksum, source_role, source_url, page_count, extraction_json, created_at, kb_documents(title)";
const revisionColumns = "id, revision, previous_revision_id, request_id, content_sha256, source_ids, created_by, created_at";

/** Paginate immutable rows in a stable order; never silently omit an older source or revision. */
export async function loadWorkProgramPreparation(supabase: Awaited<ReturnType<typeof createClient>>, programId: string): Promise<WorkProgramPreparation> {
  const latestResult = await supabase.from("program_work_program_revisions").select(`${revisionColumns}, content_json`).eq("program_id", programId).order("revision", { ascending: false }).limit(1).maybeSingle();
  if (latestResult.error) throw new Error("Could not load the latest work-program revision");
  const latest = latestResult.data as WorkProgramRevision | null;
  const sources: WorkProgramSource[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await supabase.from("program_work_program_sources").select(sourceColumns).eq("program_id", programId).order("created_at").order("id").range(offset, offset + 99);
    if (result.error) throw new Error("Could not load retained work-program sources");
    const rows = result.data ?? [];
    for (const raw of rows) {
      const row = raw as unknown as Omit<WorkProgramSource, "title"> & { kb_documents: { title: string } | { title: string }[] | null };
      const document = Array.isArray(row.kb_documents) ? row.kb_documents[0] : row.kb_documents;
      if (!document) throw new Error("A retained source document is unavailable");
      const { kb_documents: _document, ...source } = row;
      sources.push({ ...source, title: document.title });
    }
    if (rows.length < 100) break;
  }
  const revisions: WorkProgramPreparation["revisions"] = [];
  // Bound history to the captured latest revision so a concurrent save cannot
  // produce a history that appears newer than the document being edited.
  if (latest) for (let offset = 0; ; offset += 100) {
    const result = await supabase.from("program_work_program_revisions").select(revisionColumns).eq("program_id", programId).lte("revision", latest.revision).order("revision", { ascending: false }).range(offset, offset + 99);
    if (result.error) throw new Error("Could not load work-program history");
    const rows = (result.data ?? []) as WorkProgramPreparation["revisions"];
    revisions.push(...rows);
    if (rows.length < 100) break;
  }
  return { sources, latest, revisions };
}
