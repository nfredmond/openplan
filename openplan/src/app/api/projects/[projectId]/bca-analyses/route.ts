import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { authorizeBcaProject } from "@/lib/bca/workbench/access";
import { canonicalBcaJson } from "@/lib/bca/workbench/canonical";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { bcaDocumentSchema } from "@/lib/bca/workbench/schema";
import { bcaPlaceReview, readBcaProjectPlace } from "@/lib/bca/workbench/project-place";
import {
  calculateBcaDocument,
  WORKBENCH_ENGINE_VERSION,
} from "@/lib/bca/workbench/engine";

const payloadSchema = z
  .object({ id: z.string().uuid(), document: bcaDocumentSchema })
  .strict();
const projection =
  "id, project_id, created_by, created_at, document_json, engine_version";
function hash(value: unknown) {
  return createHash("sha256").update(canonicalBcaJson(value)).digest("hex");
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const access = await authorizeBcaProject(projectId, false);
  if (access.error) return access.error;
  const id = request.nextUrl.searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
  const cursor = request.nextUrl.searchParams.get("before");
  const cursorId = request.nextUrl.searchParams.get("beforeId");
  if (
    (cursor || cursorId) &&
    (!cursor ||
      !cursorId ||
      !z.string().datetime({ offset: true }).safeParse(cursor).success ||
      !z.string().uuid().safeParse(cursorId).success)
  )
    return NextResponse.json(
      { error: "Invalid history cursor" },
      { status: 400 },
    );
  let query = access.supabase
    .from("project_bca_versions")
    .select(projection)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (id) query = query.eq("id", id);
  if (cursor && cursorId)
    query = query.or(
      `created_at.lt.${cursor},and(created_at.eq.${cursor},id.lt.${cursorId})`,
    );
  const { data, error } = await query.limit(101);
  if (error)
    return NextResponse.json(
      {
        error:
          "Analysis history could not be loaded. Check the BCA migration and retry.",
      },
      { status: 500 },
    );
  const projectPlace = readBcaProjectPlace(projectId, access.project);
  return NextResponse.json({
    versions: (data ?? [])
      .slice(0, 100)
      .map((row) => {
        const document = bcaDocumentSchema.safeParse(row.document_json);
        return { ...row, inputHash: hash(row.document_json), projectPlaceReview:
          document.success && document.data.projectId === projectId
            ? bcaPlaceReview(document.data, projectPlace) : { status: "invalid-document" } };
      }),
    hasMore: (data?.length ?? 0) > 100,
    projectPlace,
  });
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  // No BCA write action exists in the Planner Agent registry. Refuse its
  // execution headers rather than treating an unsupported write as human input.
  if (
    [
      "x-openplan-assistant-execution-source",
      "x-openplan-assistant-input-hash",
      "x-openplan-assistant-approval-id",
    ].some((key) => request.headers.has(key))
  )
    return NextResponse.json(
      {
        error:
          "Planner Agent BCA writes are not supported. Use the BCA workbench.",
      },
      { status: 403 },
    );
  const { projectId } = await context.params;
  const access = await authorizeBcaProject(projectId, true);
  if (access.error) return access.error;
  const body = await readJsonOrNullWithLimit(request, 1000000);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Invalid analysis document",
        issues: parsed.error.issues.slice(0, 10),
      },
      { status: 400 },
    );
  if (parsed.data.document.projectId !== projectId)
    return NextResponse.json(
      { error: "The analysis belongs to a different project" },
      { status: 400 },
    );
  const calculation = calculateBcaDocument(parsed.data.document);
  const inputHash = hash(parsed.data.document);
  // Resolve an existing request before checking mutable project context. A
  // legacy or stale exact replay must recover its original immutable result.
  const readPrior = () => access.supabase.from("project_bca_versions").select(projection)
    .eq("project_id", projectId).eq("id", parsed.data.id).maybeSingle();
  const replay = (prior: { created_by: string; document_json: unknown }) => {
    if (prior.created_by === access.user.id && hash(prior.document_json) === inputHash)
      return NextResponse.json({ version: { ...prior, inputHash }, calculation, replayed: true });
    return NextResponse.json({ error: "This save identifier already belongs to different content. Load history before saving a new version." }, { status: 409 });
  };
  const existing = await readPrior();
  if (existing.error)
    return NextResponse.json({ error: "Save outcome is unknown. Retry the same request." }, { status: 503 });
  if (existing.data) return replay(existing.data);
  const projectPlace = readBcaProjectPlace(projectId, access.project);
  if (parsed.data.document.schemaVersion !== 2)
    return NextResponse.json({ error: "This analysis is unbound. Review the project's place to create a new version. Existing retained requests can still recover an exact prior save." }, { status: 409 });
  if (projectPlace.status !== "available")
    return NextResponse.json({ error: projectPlace.message, projectPlace }, { status: 409 });
  if (bcaPlaceReview(parsed.data.document, projectPlace).status !== "matched-at-read")
    return NextResponse.json({ error: "The project changed since place review. Preserve this request, refresh the project place and explicitly review a new version.", projectPlace }, { status: 409 });
  const audit = createApiAuditLogger("projects.bca-analyses.save", request);
  const { data, error } = await access.supabase
    .from("project_bca_versions")
    .insert({
      id: parsed.data.id,
      project_id: projectId,
      created_by: access.user.id,
      document_json: parsed.data.document,
      engine_version: WORKBENCH_ENGINE_VERSION,
    })
    .select(projection)
    .single();
  if (error?.code === "23505") {
    const prior = await readPrior();
    if (prior.error)
      return NextResponse.json(
        { error: "Save outcome is unknown. Retry the same request." },
        { status: 503 },
      );
    if (prior.data) return replay(prior.data);
    return NextResponse.json(
      {
        error:
          "This save identifier already belongs to different content. Load history before saving a new version.",
      },
      { status: 409 },
    );
  }
  if (error?.code === "PT409")
    return NextResponse.json({ error: "The project changed before the database retained this version. Preserve the original request, refresh the project place and explicitly review a new version." }, { status: 409 });
  if (error) {
    audit.error("save_failed", { code: error.code });
    return NextResponse.json(
      {
        error:
          "Save was not confirmed. Retry the same request to recover its result.",
      },
      { status: 503 },
    );
  }
  audit.info("version_saved", {
    projectId,
    versionId: parsed.data.id,
    inputHash,
  });
  return NextResponse.json(
    { version: { ...data, inputHash }, calculation },
    { status: 201 },
  );
}
