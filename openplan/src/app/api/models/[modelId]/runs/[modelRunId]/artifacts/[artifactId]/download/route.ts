import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import {
  parseStorageRef,
  resolveContainedLocalPath,
  resolveRunWorkDir,
  storageRefAllowed,
  workerLocalRoot,
} from "@/lib/models/artifact-source";

// Matches ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS — short-lived links minted
// per-request for an already-authorized reader; never a stored public URL.
const RUN_ARTIFACT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const CONTENT_TYPES: Record<string, string> = {
  ".geojson": "application/geo+json",
  ".json": "application/json",
  ".csv": "text/csv",
};

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string; artifactId: string }>;
};

async function loadAuthorizedRun(modelId: string, modelRunId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const access = await loadModelAccess(supabase, modelId, user.id, "models.read");
  if (access.error) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model" }, { status: 500 }) } as const;
  }
  if (!access.model) {
    return { errorResponse: NextResponse.json({ error: "Model not found" }, { status: 404 }) } as const;
  }
  if (!access.membership || !access.allowed) {
    return { errorResponse: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) } as const;
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("id, model_id")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError) {
    return { errorResponse: NextResponse.json({ error: "Failed to load model run" }, { status: 500 }) } as const;
  }
  if (!run) {
    return { errorResponse: NextResponse.json({ error: "Model run not found" }, { status: 404 }) } as const;
  }

  return { supabase, run } as const;
}

// GET /api/models/[modelId]/runs/[modelRunId]/artifacts/[artifactId]/download
// Resolves an artifact's private storage reference to a short-TTL signed URL
// (or streams dev-local files when OPENPLAN_WORKER_LOCAL_ROOT is set).
export async function GET(req: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("model_runs.artifact.download", req);
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid artifact route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(parsedParams.data.modelId, parsedParams.data.modelRunId);
  if ("errorResponse" in auth) {
    return auth.errorResponse;
  }

  const { data: artifact, error: artifactError } = await auth.supabase
    .from("model_run_artifacts")
    .select("id, run_id, artifact_type, file_url")
    .eq("id", parsedParams.data.artifactId)
    .eq("run_id", parsedParams.data.modelRunId)
    .maybeSingle();

  if (artifactError) {
    audit.error("model_run_artifact_lookup_failed", {
      artifactId: parsedParams.data.artifactId,
      message: artifactError.message,
    });
    return NextResponse.json({ error: "Failed to load artifact" }, { status: 500 });
  }
  if (!artifact || typeof artifact.file_url !== "string" || !artifact.file_url) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const fileUrl = artifact.file_url as string;

  // file_url is member-writable data (artifact rows can be registered by any
  // workspace member, and the skims API accepts caller-supplied file_url), so
  // every dereference is scoped to the run this request already authorized.
  const runScope = {
    bucket: "run-artifacts",
    objectPathPrefix: `model-runs/${parsedParams.data.modelRunId}/`,
  } as const;

  const storageRef = parseStorageRef(fileUrl);
  if (storageRef) {
    if (!storageRefAllowed(storageRef, runScope)) {
      audit.warn("model_run_artifact_ref_out_of_scope", {
        artifactId: artifact.id,
        bucket: storageRef.bucket,
      });
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const { data, error } = await service.storage
      .from(storageRef.bucket)
      .createSignedUrl(storageRef.objectPath, RUN_ARTIFACT_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      audit.error("model_run_artifact_sign_failed", {
        artifactId: artifact.id,
        bucket: storageRef.bucket,
        message: error?.message ?? "no signed url",
      });
      return NextResponse.json({ error: "Failed to sign artifact URL" }, { status: 500 });
    }

    return NextResponse.redirect(data.signedUrl);
  }

  // Redirecting to a member-controlled remote URL would make this route an
  // open-redirect surface; legacy public bucket URLs were repaired to
  // storage:// refs by migration 20260718000086.
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    return NextResponse.json(
      { error: "Remote artifact URLs are not downloadable." },
      { status: 404 }
    );
  }

  // local:// and bare filesystem refs are worker-local; only meaningful when
  // the app shares a disk with the worker (dev). Hosted envs get an honest 404,
  // and reads are contained to this run's work dir.
  const localRoot = workerLocalRoot();
  if (!localRoot) {
    return NextResponse.json(
      { error: "Artifact is stored on the worker host and is not downloadable from this environment." },
      { status: 404 }
    );
  }

  const localPath = resolveContainedLocalPath(
    fileUrl,
    resolveRunWorkDir(localRoot, parsedParams.data.modelRunId)
  );
  if (!localPath) {
    audit.warn("model_run_artifact_local_ref_out_of_scope", {
      artifactId: artifact.id,
    });
    return NextResponse.json({ error: "Artifact file is not readable" }, { status: 404 });
  }

  try {
    const payload = await readFile(localPath);
    const basename = path.basename(localPath);
    const contentType = CONTENT_TYPES[path.extname(basename).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(payload), {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${basename}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Artifact file is not readable" }, { status: 404 });
  }
}
