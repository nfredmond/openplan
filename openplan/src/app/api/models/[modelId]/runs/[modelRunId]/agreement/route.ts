import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { AGREEMENT_VERIFICATION_HEADERS } from "@/lib/models/demand-agreement-artifact";
import { loadRegisteredDualDemandAgreement } from "@/lib/models/verified-dual-demand-agreement-server";
import {
  loadArtifactBytes,
  resolveRunWorkDir,
  workerLocalRoot,
} from "../volumes/artifact-source";

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ modelId: string; modelRunId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.agreement", request);
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const { modelId, modelRunId } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await loadModelAccess(supabase, modelId, user.id, "models.read");
  if (access.error) return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  if (!access.model) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const result = await loadRegisteredDualDemandAgreement(
    supabase,
    {
      modelRunId,
      artifactType: "demand_model_agreement_geojson",
      expectedModelId: access.model.id,
      expectedWorkspaceId: access.model.workspace_id,
    },
    { loadArtifactBytes, workerLocalRoot, resolveRunWorkDir },
  );

  if (result.status === "absent") {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  if (result.status === "unreadable") {
    audit.error("agreement_artifact_read_failed", { modelRunId, reason: result.reason });
    const missingBytes = result.reason.startsWith("The agreement artifact bytes");
    return NextResponse.json({ error: result.reason }, { status: missingBytes ? 404 : 500 });
  }
  if (result.status === "invalid") {
    audit.error("agreement_artifact_verification_failed", { modelRunId, reason: result.reason });
    const incompleteRun = result.reason === "The model run did not succeed.";
    return NextResponse.json({ error: result.reason }, { status: incompleteRun ? 400 : 422 });
  }

  audit.info("agreement_artifact_read", {
    modelRunId,
    artifactId: result.agreement.artifactId,
    stageId: result.stageId,
    artifactSha256: result.verification.artifactSha256,
    permittedAttributionScale: result.agreement.permittedAttributionScale,
  });
  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "content-length": String(result.bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      [AGREEMENT_VERIFICATION_HEADERS.artifact]: result.verification.artifactSha256,
      [AGREEMENT_VERIFICATION_HEADERS.assignmentProfile]:
        result.verification.assignmentProfileSha256,
      [AGREEMENT_VERIFICATION_HEADERS.networkSettings]:
        result.verification.networkSettingsSha256,
      [AGREEMENT_VERIFICATION_HEADERS.networkState]: result.verification.networkStateSha256,
    },
  });
}
