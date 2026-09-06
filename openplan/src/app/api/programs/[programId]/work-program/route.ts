import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { workProgramDraftSchema } from "@/lib/programs/work-program/schema";
import { validateWorkProgramSources } from "@/lib/programs/work-program/source-review";
import { authorizeWorkProgram, loadWorkProgramPreparation } from "@/lib/programs/work-program/server";

type Context = { params: Promise<{ programId: string }> };
const saveSchema = z.object({ expectedRevision: z.number().int().min(0), requestId: z.string().uuid(), draft: workProgramDraftSchema }).strict();

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.read", request);
  try {
    const { programId } = await context.params;
    const access = await authorizeWorkProgram(request, programId, false);
    if (access.response) return access.response;
    return NextResponse.json(await loadWorkProgramPreparation(access.supabase, programId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    audit.error("work_program_read_failed", { error });
    return NextResponse.json({ error: "Could not load the work program. Your saved revisions remain available when the connection recovers." }, { status: 503 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("programs.workProgram.save", request);
  try {
    const { programId } = await context.params;
    const access = await authorizeWorkProgram(request, programId, true);
    if (access.response) return access.response;
    const body = await readJsonOrNullWithLimit(request, 2_000_000);
    if (!body.ok) return body.response;
    const parsed = saveSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Correct the proposal before saving", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400 });
    const { sources } = await loadWorkProgramPreparation(access.supabase, programId);
    const referenceError = validateWorkProgramSources(parsed.data.draft, sources);
    if (referenceError) return NextResponse.json({ error: referenceError }, { status: 400 });
    const result = await createServiceRoleClient().rpc("save_program_work_program_revision", {
      p_program_id: programId, p_actor_id: access.user.id, p_expected_revision: parsed.data.expectedRevision,
      p_request_id: parsed.data.requestId, p_content: parsed.data.draft,
    });
    if (result.error) {
      const conflict = result.error.code === "PT409";
      audit.warn("work_program_save_refused", { programId, code: result.error.code });
      return NextResponse.json({ error: conflict ? "The saved proposal or retry payload changed. Keep your local changes and reload the latest revision before merging them." : "The proposal could not be saved. Check program, project and source access before retrying." }, { status: conflict ? 409 : result.error.code === "42501" ? 403 : 503 });
    }
    audit.info("work_program_revision_saved", { programId, userId: access.user.id, requestId: parsed.data.requestId });
    return NextResponse.json({ revision: result.data });
  } catch (error) {
    audit.error("work_program_save_failed", { error });
    return NextResponse.json({ error: "The save could not be confirmed. Retry with the same proposal to recover its result." }, { status: 503 });
  }
}
