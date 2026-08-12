/**
 * OPENING AN INGEST — where a file's coordinate system is decided, and the only
 * place in this lane that decides it.
 *
 * The browser has already parsed the file (it is 200 MB; nothing else could)
 * and is about to post its features in batches. Before any of that, it sends
 * what the file SAID about its coordinate system — the .prj text verbatim — or
 * the system the planner picked when the file said nothing. This route resolves
 * that against the CRS registry and writes the answer, with its basis, onto a
 * new version row. From here on the version is the ingest job: the browser
 * posts against its id, and the database refuses to call it finished until the
 * count that arrived equals the count declared here.
 *
 * REGISTRY DISPOSITION — REFUSED as an assistant action, 2026-08-12. This is
 * the sharpest refusal in the lane: it turns a coordinate system into an
 * assertion a NAMED PERSON made. A model will produce a State Plane zone
 * fluently and wrongly, land the layer 40 km away, and leave an approval record
 * saying the planner asserted it. Executable form:
 * `src/test/refused-workspace-gis-actions-stay-refused.test.ts`.
 */
import { NextRequest, NextResponse } from "next/server";

import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  resolveWorkspaceLayerFeatureCap,
  workspaceLayerFeatureCapMessage,
} from "@/lib/workspace-gis/caps";
import {
  describeSpatialConversionAvailability,
  isSpatialConversionWorkerConfigured,
} from "@/lib/workspace-gis/conversion-availability";
import { resolveWorkspaceGisCrs } from "@/lib/workspace-gis/crs-resolution";
import { WORKSPACE_GIS_CRS_REGISTRY } from "@/lib/workspace-gis/crs-registry-binding";
import {
  WORKSPACE_GIS_INGEST_BATCH_SIZE,
  validateIngestOpenRequest,
} from "@/lib/workspace-gis/ingest";
import { describeWorkspaceLayerVersion } from "@/lib/workspace-gis/coverage";
import {
  WORKSPACE_GIS_VERSION_COLUMNS,
  mapVersionRow,
} from "@/lib/workspace-gis/store";
import type { WorkspaceGisIngestOpenResponse } from "@/lib/workspace-gis/types";

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("workspace-gis.ingest.open", request);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership || isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role in this workspace can read map layers but not upload them." },
        { status: 403 }
      );
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.documentJson);
    if (!body.ok) return body.response;

    const validation = validateIngestOpenRequest(body.data);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }
    const input = validation.request;

    // A format OpenPlan cannot read in-process gets the refusal that teaches
    // the planner the four-click way out, not a generic "unsupported file".
    if (input.sourceFormat === "file_geodatabase") {
      const notice = describeSpatialConversionAvailability(
        isSpatialConversionWorkerConfigured(),
        "file geodatabase"
      );
      return NextResponse.json(
        {
          error: notice.title,
          description: notice.description,
          exportPath: notice.exportPath,
        },
        { status: 501 }
      );
    }

    // THE DEPLOYMENT CAP REFUSES THE UPLOAD; IT DOES NOT TRIM IT. Storing the
    // first N shapes of a parcel fabric produces a fabric with the tail missing
    // and nothing on the map to say so — the defect this lane exists to avoid.
    const featureCap = resolveWorkspaceLayerFeatureCap();
    if (featureCap !== null && input.sourceFeatureCount > featureCap) {
      return NextResponse.json(
        { error: workspaceLayerFeatureCapMessage(featureCap, input.sourceFeatureCount) },
        { status: 413 }
      );
    }

    // THE REGISTRY IS PASSED HERE, EXPLICITLY, AND THAT IS THE POINT. This lane
    // shipped once with a resolver that expected the registry to have
    // registered itself; nothing had, so every projected shapefile — the State
    // Plane files this feature exists for — was refused in production while the
    // tests, which injected their own registry, stayed green. Naming it at the
    // call site is what makes its absence a compile error instead of a 422.
    const crs = resolveWorkspaceGisCrs(
      {
        sourceFormat: input.sourceFormat,
        prjText: input.prjText,
        assertedSrsCode: input.assertedSrsCode,
      },
      WORKSPACE_GIS_CRS_REGISTRY
    );
    if (!crs.ok) {
      return NextResponse.json({ error: crs.message, reason: crs.reason }, { status: 422 });
    }

    // A datum that can put shapes a disclosable distance from truth is accepted
    // — these are the legacy files the feature exists for — but never silently.
    // The acknowledgement is a fact about a PERSON, so it is recorded like one.
    if (crs.entry.requiresDatumAcknowledgement && !input.datumAcknowledged) {
      return NextResponse.json(
        {
          error:
            crs.entry.datumShiftNote ??
            `${crs.entry.name} uses the ${crs.entry.datum} datum, which OpenPlan cannot transform exactly. Confirm you accept that before uploading.`,
          reason: "datum_acknowledgement_required",
          datum: crs.entry.datum,
        },
        { status: 409 }
      );
    }

    const isAsserted = crs.basis === "planner_asserted";
    const now = new Date().toISOString();

    // Version numbers are per layer and visible to the planner ("version 3"),
    // so they are sequential rather than random. A race loses the unique index
    // and is retried once with a re-read number.
    const insertVersion = async (versionNumber: number) =>
      supabase
        .from("workspace_gis_layer_versions")
        .insert({
          layer_id: input.layerId,
          workspace_id: membership.workspace_id,
          version_number: versionNumber,
          source_format: input.sourceFormat,
          source_filename: input.sourceFilename,
          source_byte_size: input.sourceByteSize,
          srs_authority: crs.entry.authority,
          srs_code: crs.entry.code,
          srs_name: crs.entry.name,
          srs_basis: crs.basis,
          srs_asserted_by: isAsserted ? user.id : null,
          srs_asserted_at: isAsserted ? now : null,
          reprojection_engine: input.reprojectionEngine,
          datum_shift_note: crs.entry.datumShiftNote,
          datum_acknowledged_by: crs.entry.requiresDatumAcknowledgement ? user.id : null,
          datum_acknowledged_at: crs.entry.requiresDatumAcknowledgement ? now : null,
          geometry_kinds: input.geometryKinds,
          attribute_fields: input.attributeFields,
          attribute_encoding: input.attributeEncoding ?? null,
          attribute_encoding_is_fallback: input.attributeEncodingIsFallback ?? false,
          declared_feature_count: input.declaredFeatureCount,
          source_feature_count: input.sourceFeatureCount,
          dropped_feature_count: input.droppedFeatureCount,
          truncated:
            input.declaredFeatureCount + input.droppedFeatureCount < input.sourceFeatureCount,
          bbox: input.bbox,
          ingest_status: "receiving",
          created_by: user.id,
        })
        .select(WORKSPACE_GIS_VERSION_COLUMNS)
        .single();

    /**
     * The next version number, or null when the highest could not be READ.
     *
     * The distinction matters more than it looks. A failed read that fell back
     * to "0, so this is version 1" would either collide with an existing
     * version 1 — recoverable — or, on a layer whose earlier versions were
     * hidden by a transient error, silently renumber this agency's upload
     * history. Neither is worth guessing at, so the ingest refuses to open.
     */
    const nextVersionNumber = async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("workspace_gis_layer_versions")
        .select("version_number")
        .eq("layer_id", input.layerId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        audit.error("workspace_gis_version_number_read_failed", {
          layerId: input.layerId,
          message: error.message,
          code: error.code ?? null,
        });
        return null;
      }

      const highest = (data as { version_number?: number } | null)?.version_number ?? 0;
      return highest + 1;
    };

    const versionNumber = await nextVersionNumber();
    if (versionNumber === null) {
      return NextResponse.json(
        {
          error:
            "OpenPlan could not read this layer's upload history, so it did not start a new upload. Nothing was stored; try again.",
        },
        { status: 500 }
      );
    }

    let result = await insertVersion(versionNumber);
    if (result.error?.code === "23505") {
      // Another upload of the same layer took this number between the read and
      // the insert. Re-read and try once; a second collision is answered
      // honestly rather than retried forever.
      const retryNumber = await nextVersionNumber();
      if (retryNumber !== null) result = await insertVersion(retryNumber);
    }

    if (result.error) {
      // 23503 = the layer id names nothing this member can write to. Reported
      // as "not found" rather than "forbidden": RLS has already decided which
      // layers exist for this caller, and distinguishing the two here would
      // tell an outsider that an id is real.
      if (result.error.code === "23503") {
        return NextResponse.json({ error: "Map layer not found" }, { status: 404 });
      }
      audit.error("workspace_gis_ingest_open_failed", {
        layerId: input.layerId,
        message: result.error.message,
        code: result.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to open the upload" }, { status: 500 });
    }

    const version = mapVersionRow(result.data as unknown as Record<string, unknown>);

    audit.info("workspace_gis_ingest_opened", {
      workspaceId: membership.workspace_id,
      layerId: input.layerId,
      versionId: version.id,
      srsBasis: crs.basis,
      declaredFeatureCount: input.declaredFeatureCount,
    });

    const payload: WorkspaceGisIngestOpenResponse = {
      version,
      batchSize: WORKSPACE_GIS_INGEST_BATCH_SIZE,
      notes: describeWorkspaceLayerVersion(version),
    };
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    audit.error("workspace_gis_ingest_open_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while opening the upload" },
      { status: 500 }
    );
  }
}
