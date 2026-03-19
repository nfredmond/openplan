import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type QaCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  count?: number;
};

function validateGeoJsonFeatures(geojson: unknown, label: string): QaCheck[] {
  const checks: QaCheck[] = [];

  if (!geojson || typeof geojson !== "object") {
    checks.push({ name: `${label}_present`, status: "fail", message: `${label} is missing or not valid JSON.` });
    return checks;
  }

  const fc = geojson as Record<string, unknown>;
  const features = Array.isArray(fc.features) ? fc.features : [];

  if (features.length === 0) {
    checks.push({ name: `${label}_present`, status: "fail", message: `${label} has zero features.` });
  } else {
    checks.push({ name: `${label}_present`, status: "pass", message: `Found ${features.length} features in ${label}.` });
  }

  // Check geometry validity (basic: all features have geometry with coordinates)
  let missingGeom = 0;
  for (const f of features) {
    const feat = f as Record<string, unknown>;
    const geom = feat.geometry as Record<string, unknown> | null | undefined;
    if (!geom || !geom.coordinates) {
      missingGeom++;
    }
  }

  if (missingGeom > 0) {
    checks.push({
      name: `${label}_geometry_valid`,
      status: missingGeom === features.length ? "fail" : "warn",
      message: `${missingGeom} feature(s) in ${label} missing geometry/coordinates.`,
      count: missingGeom,
    });
  } else {
    checks.push({ name: `${label}_geometry_valid`, status: "pass", message: `All ${label} features have valid geometry.` });
  }

  return checks;
}

// POST /api/network-packages/[packageId]/versions/[versionId]/ingest
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string; versionId: string }> }
) {
  const { packageId, versionId } = await params;
  const supabase = await createClient();

  // Accept JSON body with nodes and links GeoJSON inline for the v1 prototype
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const nodesGeojson = body.nodes ?? null;
  const linksGeojson = body.links ?? null;

  // Run QA checks
  const checks: QaCheck[] = [];
  checks.push(...validateGeoJsonFeatures(nodesGeojson, "nodes"));
  checks.push(...validateGeoJsonFeatures(linksGeojson, "links"));

  // Check for duplicate node IDs
  if (nodesGeojson && typeof nodesGeojson === "object") {
    const fc = nodesGeojson as Record<string, unknown>;
    const features = Array.isArray(fc.features) ? fc.features : [];
    const ids = features
      .map((f) => ((f as Record<string, unknown>).properties as Record<string, unknown> | undefined)?.id)
      .filter(Boolean);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size < ids.length) {
      checks.push({
        name: "duplicate_node_ids",
        status: "warn",
        message: `${ids.length - uniqueIds.size} duplicate node ID(s) detected.`,
        count: ids.length - uniqueIds.size,
      });
    } else {
      checks.push({ name: "duplicate_node_ids", status: "pass", message: "No duplicate node IDs." });
    }
  }

  // Missing link attributes check
  if (linksGeojson && typeof linksGeojson === "object") {
    const fc = linksGeojson as Record<string, unknown>;
    const features = Array.isArray(fc.features) ? fc.features : [];
    let missingAttrs = 0;
    for (const f of features) {
      const props = (f as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      if (!props?.speed && !props?.capacity) {
        missingAttrs++;
      }
    }
    if (missingAttrs > 0) {
      checks.push({
        name: "link_attributes",
        status: "warn",
        message: `${missingAttrs} link(s) missing speed or capacity attributes.`,
        count: missingAttrs,
      });
    } else {
      checks.push({ name: "link_attributes", status: "pass", message: "All links have speed/capacity attributes." });
    }
  }

  const totalChecks = checks.length;
  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  const overallStatus = failures > 0 ? "fail" : warnings > 0 ? "warn" : "pass";

  const qaReport = {
    run_at: new Date().toISOString(),
    status: overallStatus,
    checks,
    summary: { total_checks: totalChecks, passed, warnings, failures },
  };

  // Build manifest
  const manifest: Record<string, unknown> = {};
  if (nodesGeojson) manifest.nodes_file = "nodes.geojson";
  if (linksGeojson) manifest.links_file = "links.geojson";
  if (body.crs) manifest.crs = body.crs;

  // Update the version record with QA report and manifest
  const { error: updateError } = await supabase
    .from("network_package_versions")
    .update({
      qa_report_json: qaReport,
      manifest_json: manifest,
      status: overallStatus === "fail" ? "draft" : "active",
    })
    .eq("id", versionId)
    .eq("package_id", packageId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    status: overallStatus,
    qa_report: qaReport,
    message:
      overallStatus === "fail"
        ? "Ingestion failed QA checks. Fix the issues and re-upload."
        : overallStatus === "warn"
        ? "Ingestion completed with warnings. Review the QA report."
        : "Ingestion passed all QA checks.",
  });
}
