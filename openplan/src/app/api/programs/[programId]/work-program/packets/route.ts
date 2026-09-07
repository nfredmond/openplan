import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
const querySchema = z.object({ revision: z.coerce.number().int().positive(), sequence: z.coerce.number().int().nonnegative(), audience: z.enum(["internal", "public"]), format: z.enum(["html", "pdf", "xlsx"]), publicReviewed: z.enum(["1"]).optional(), download: z.enum(["1"]).optional() }).strict();
type Context = { params: Promise<{ programId: string }> };
export async function GET(request: NextRequest, context: Context) {
  const { programId } = await context.params;
  const access = await authorizeWorkProgram(request, programId, false);
  if (access.response) return access.response;
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Choose a saved revision, history version and format" }, { status: 400 });
  const revision = await access.supabase.from("program_work_program_revisions").select("id").eq("program_id", programId).eq("revision", query.data.revision).maybeSingle();
  if (revision.error || !revision.data) return NextResponse.json({ error: "Saved revision unavailable" }, { status: 404 });
  const packet = await access.supabase.from("program_work_program_packets").select("id, snapshot_hash").eq("revision_id", revision.data.id).eq("sequence", query.data.sequence).eq("audience", query.data.audience).maybeSingle();
  if (packet.error) return NextResponse.json({ error: "Review snapshot unavailable" }, { status: 503 });
  const headers = { "Cache-Control": "private, no-store" };
  if (!packet.data) return NextResponse.json({ status: "not_prepared" }, { headers });
  const artifact = await access.supabase.from("kb_documents").select("id, checksum, status").eq("work_program_packet_id", packet.data.id).eq("work_program_packet_format", query.data.format).maybeSingle();
  if (artifact.error) return NextResponse.json({ error: "Review artifact unavailable" }, { status: 503 });
  if (!artifact.data) return NextResponse.json({ status: "not_prepared" }, { headers });
  if (query.data.download && artifact.data.checksum) return new NextResponse(null, { status: 307, headers: { ...headers, Location: `/api/knowledge-base/documents/${artifact.data.id}/download?delivery=authenticated` } });
  const job = await access.supabase.from("kb_ocr_jobs").select("id, status, progress, failure_detail").eq("document_id", artifact.data.id).eq("job_kind", "work_program_export").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (job.error) return NextResponse.json({ error: "Review job unavailable" }, { status: 503 });
  return NextResponse.json({ status: job.data?.status ?? "not_prepared", job: job.data, artifact: artifact.data, snapshotHash: packet.data.snapshot_hash }, { headers });
}
export async function POST(request: NextRequest, context: Context) {
  const { programId } = await context.params;
  const audit = createApiAuditLogger("programs.workProgram.packet", request);
  const access = await authorizeWorkProgram(request, programId, false);
  if (access.response) return access.response;
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Review packets are not a registered agent action." }, { status: 403 });
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Choose a saved revision, history version and format" }, { status: 400 });
  const q = query.data;
  const result = await createServiceRoleClient().rpc("enqueue_work_program_packet", { p_program_id: programId, p_revision: q.revision, p_sequence: q.sequence, p_audience: q.audience, p_public_reviewed: q.publicReviewed === "1", p_format: q.format, p_actor_id: access.user.id });
  if (result.error) {
    audit.warn("packet_refused", { programId, code: result.error.code });
    return NextResponse.json({ error: "Packet could not be queued. Reload review history and check public-copy approval and access." }, { status: result.error.code === "42501" ? 403 : result.error.code === "PT409" ? 409 : 503 });
  }
  audit.info("packet_queued", { programId, revision: q.revision, sequence: q.sequence, audience: q.audience });
  return NextResponse.json({ job: result.data }, { headers: { "Cache-Control": "private, no-store" } });
}
