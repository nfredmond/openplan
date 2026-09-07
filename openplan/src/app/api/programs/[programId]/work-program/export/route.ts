import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";

const querySchema = z.object({ revision: z.coerce.number().int().positive(), format: z.enum(["html", "pdf", "xlsx"]), download: z.enum(["1"]).optional() }).strict();
type Context = { params: Promise<{ programId: string }> };

/** Rendering is durable background work; GET only reads status or delivers a retained file. */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.export", request);
  const {programId} = await context.params;
  const access = await authorizeWorkProgram(request,programId,false);
  if(access.response) { audit.warn("export_access_refused", { status: access.response.status }); return access.response; }
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if(!query.success) return NextResponse.json({error:"Choose a saved revision and format"},{status:400});
  const revision = await access.supabase.from("program_work_program_revisions").select("id, content_sha256").eq("program_id",programId).eq("revision",query.data.revision).maybeSingle();
  if(revision.error) return NextResponse.json({error:"Saved revision unavailable"},{status:503});
  if(!revision.data) return NextResponse.json({error:"Revision not found"},{status:404});
  const artifact = await access.supabase.from("kb_documents").select("id, checksum, status").eq("work_program_revision_id",revision.data.id).eq("work_program_export_format",query.data.format).maybeSingle();
  if(artifact.error) return NextResponse.json({error:"Review file status unavailable"},{status:503});
  if(!artifact.data) return NextResponse.json({status:"not_prepared"},{headers:{"Cache-Control":"private, no-store"}});
  if(query.data.download && artifact.data.checksum) return new NextResponse(null, { status: 307, headers: { Location: `/api/knowledge-base/documents/${artifact.data.id}/download?delivery=authenticated`, "Cache-Control": "private, no-store" } });
  const job = await access.supabase.from("kb_ocr_jobs").select("id, status, progress, failure_detail, message").eq("document_id",artifact.data.id).eq("job_kind","work_program_export").order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(job.error) return NextResponse.json({error:"Review file status unavailable"},{status:503});
  return NextResponse.json({status:job.data?.status??"not_prepared",job:job.data,artifact:artifact.data,revisionHash:revision.data.content_sha256},{headers:{"Cache-Control":"private, no-store"}});
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.export", request);
  const {programId} = await context.params;
  const access = await authorizeWorkProgram(request,programId,false);
  if(access.response) { audit.warn("export_access_refused", { status: access.response.status }); return access.response; }
  if(readAssistantExecutionSource(request)!=="manual") return NextResponse.json({error:"Open the proposal to prepare review files; this is not a registered agent write action."},{status:403});
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if(!query.success) return NextResponse.json({error:"Choose a saved revision and format"},{status:400});
  const job = await createServiceRoleClient().rpc("enqueue_work_program_export",{p_program_id:programId,p_revision:query.data.revision,p_format:query.data.format,p_actor_id:access.user.id});
  if(job.error) return NextResponse.json({error:"Review file could not be queued. The saved proposal remains available."},{status:job.error.code==="42501"?403:503});
  audit.info("export_accepted", { programId, revision: query.data.revision, format: query.data.format });
  return NextResponse.json({job:job.data},{status:202,headers:{"Cache-Control":"private, no-store"}});
}
