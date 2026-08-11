import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { AERIAL_IMAGERY_BUCKET, sanitizeImageryFilename } from "@/lib/aerial/imagery";

/**
 * Download one mission photo from OpenPlan's own storage.
 *
 * Mirrors the aerial artifact custody download route segment for segment:
 * authorize the PARENT resource (mission -> workspace membership), verify the
 * imagery row belongs to that mission and its object path to that row's own
 * prefix, mint a short-lived signed URL, redirect. Any workspace role may
 * download — this is a read of workspace content, so viewers are included.
 */

// Matches the custody, report-artifact and model-run-artifact routes: a
// short-lived link minted per request for an already-authorized reader.
const AERIAL_IMAGERY_SIGNED_URL_TTL_SECONDS = 15 * 60;

const paramsSchema = z.object({
  missionId: z.string().uuid(),
  imageryId: z.string().uuid(),
});

type RouteContext = { params: Promise<{ missionId: string; imageryId: string }> };

type ImageryRow = {
  id: string;
  workspace_id: string;
  mission_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  byte_size: number;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("aerial-imagery.download", request);

  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid photo download params" }, { status: 400 });
  }
  const { missionId, imageryId } = parsedParams.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const { data: missionData, error: missionError } = await service
    .from("aerial_missions")
    .select("id, workspace_id")
    .eq("id", missionId)
    .maybeSingle();

  if (missionError) {
    audit.error("aerial_mission_lookup_failed", { missionId, message: missionError.message });
    return NextResponse.json({ error: "Failed to load mission" }, { status: 500 });
  }
  if (!missionData) {
    return NextResponse.json({ error: "Mission not found" }, { status: 404 });
  }
  const mission = missionData as { id: string; workspace_id: string };

  // Explicit membership check against the mission's own workspace.
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", mission.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    audit.error("membership_check_failed", {
      workspaceId: mission.workspace_id,
      message: membershipError.message,
    });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  // Scoped to the parent mission, so an imagery id from another mission cannot
  // be dereferenced through a mission this caller happens to be able to read.
  const { data: imageryData, error: imageryError } = await service
    .from("aerial_imagery")
    .select("id, workspace_id, mission_id, storage_bucket, storage_path, original_filename, byte_size")
    .eq("id", imageryId)
    .eq("mission_id", mission.id)
    .maybeSingle();

  if (imageryError) {
    audit.error("aerial_imagery_lookup_failed", { imageryId, message: imageryError.message });
    return NextResponse.json({ error: "Failed to load photo record" }, { status: 500 });
  }
  const imagery = (imageryData ?? null) as ImageryRow | null;
  if (!imagery) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // Belt and braces: the scope trigger writes these together, so a mismatch is
  // a forged or corrupted row — refuse as not-found rather than dereference
  // across the boundary.
  if (imagery.workspace_id !== mission.workspace_id) {
    audit.warn("aerial_imagery_workspace_mismatch", { imageryId: imagery.id, missionId: mission.id });
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const storagePath = typeof imagery.storage_path === "string" ? imagery.storage_path : "";
  const expectedPrefix = `${mission.workspace_id}/${mission.id}/${imagery.id}/`;

  // The upload route derives every path from ids OpenPlan owns, so a row whose
  // object lives outside its own prefix — or in another bucket — is not
  // something this route will sign for.
  if (
    imagery.storage_bucket !== AERIAL_IMAGERY_BUCKET ||
    !storagePath.startsWith(expectedPrefix) ||
    storagePath.includes("..")
  ) {
    audit.warn("aerial_imagery_storage_ref_out_of_scope", {
      imageryId: imagery.id,
      missionId: mission.id,
      bucket: imagery.storage_bucket,
    });
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const filename = sanitizeImageryFilename(imagery.original_filename);

  const { data: signed, error: signError } = await service.storage
    .from(imagery.storage_bucket)
    .createSignedUrl(storagePath, AERIAL_IMAGERY_SIGNED_URL_TTL_SECONDS, { download: filename });

  if (signError || !signed?.signedUrl) {
    audit.error("aerial_imagery_sign_failed", {
      imageryId: imagery.id,
      missionId: mission.id,
      message: signError?.message ?? "no signed url",
    });
    return NextResponse.json({ error: "Failed to sign photo URL" }, { status: 500 });
  }

  // The signed URL itself is never logged — it is a bearer credential for the
  // agency's own imagery.
  audit.info("aerial_imagery_download_signed", {
    imageryId: imagery.id,
    missionId: mission.id,
    workspaceId: mission.workspace_id,
    byteSize: imagery.byte_size,
  });
  return NextResponse.redirect(signed.signedUrl);
}
