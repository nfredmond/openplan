import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import {
  checkMonthlyRunQuota,
  isQuotaExceeded,
  isQuotaLookupError,
  QUOTA_WEIGHTS,
} from "@/lib/billing/quota";
import {
  isWorkspaceSubscriptionActive,
  resolveWorkspaceEntitlements,
  subscriptionGateMessage,
} from "@/lib/billing/subscription";
import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";

type QaCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  count?: number;
};

const NETWORK_PACKAGE_INGEST_MAX_BODY_BYTES = 2 * 1024 * 1024;

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
  const audit = createApiAuditLogger("network_package_versions.ingest", req);
  const { packageId, versionId } = await params;

  const bodyRead = await readJsonWithLimit<Record<string, unknown>>(req, NETWORK_PACKAGE_INGEST_MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    audit.warn("request_body_too_large", {
      packageId,
      versionId,
      byteLength: bodyRead.byteLength,
      maxBytes: NETWORK_PACKAGE_INGEST_MAX_BODY_BYTES,
    });
    return bodyRead.response;
  }

  if (bodyRead.parseError) {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const body = bodyRead.data;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: pkg, error: pkgError } = await supabase
    .from("network_packages")
    .select("id, workspace_id")
    .eq("id", packageId)
    .maybeSingle();

  if (pkgError) {
    audit.error("network_package_lookup_failed", {
      packageId,
      userId: user.id,
      message: pkgError.message,
      code: pkgError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to verify network package" }, { status: 500 });
  }

  if (!pkg) {
    return NextResponse.json({ error: "Network package not found" }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", pkg.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    audit.error("workspace_membership_lookup_failed", {
      packageId,
      workspaceId: pkg.workspace_id,
      userId: user.id,
      message: membershipError.message,
      code: membershipError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }

  if (!membership) {
    audit.warn("workspace_access_denied", {
      packageId,
      workspaceId: pkg.workspace_id,
      userId: user.id,
    });
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const { data: workspaceBilling, error: workspaceBillingError } = await supabase
    .from("workspaces")
    .select("plan, subscription_plan, subscription_status")
    .eq("id", pkg.workspace_id)
    .maybeSingle();

  if (workspaceBillingError) {
    audit.error("workspace_billing_lookup_failed", {
      workspaceId: pkg.workspace_id,
      userId: user.id,
      message: workspaceBillingError.message,
      code: workspaceBillingError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to verify workspace billing" }, { status: 500 });
  }

  if (!isWorkspaceSubscriptionActive(workspaceBilling ?? {})) {
    const gateMessage = subscriptionGateMessage(workspaceBilling ?? {});
    audit.warn("subscription_inactive", {
      workspaceId: pkg.workspace_id,
      userId: user.id,
      subscriptionStatus: workspaceBilling?.subscription_status ?? null,
    });
    return NextResponse.json({ error: gateMessage }, { status: 402 });
  }

  const { plan } = resolveWorkspaceEntitlements(workspaceBilling ?? {});
  const quota = await checkMonthlyRunQuota(supabase, {
    workspaceId: pkg.workspace_id,
    plan,
    tableName: "runs",
    weight: QUOTA_WEIGHTS.DEFAULT,
  });

  if (isQuotaLookupError(quota)) {
    audit.error("run_limit_count_failed", {
      workspaceId: pkg.workspace_id,
      userId: user.id,
      message: quota.message,
      code: quota.code,
    });
    return NextResponse.json({ error: "Failed to validate plan limits" }, { status: 500 });
  }

  if (isQuotaExceeded(quota)) {
    audit.warn("run_limit_reached", {
      workspaceId: pkg.workspace_id,
      userId: user.id,
      plan: quota.plan,
      usedRuns: quota.usedRuns,
      monthlyLimit: quota.monthlyLimit,
    });
    return NextResponse.json({ error: quota.message }, { status: 429 });
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

  // Update the version record with QA report and manifest. Scoped by both
  // version id and package id so a versionId that doesn't belong to this
  // package can't be silently ingested. .select("id") + length check turns
  // the zero-rows case into an explicit 404.
  const { data: updated, error: updateError } = await supabase
    .from("network_package_versions")
    .update({
      qa_report_json: qaReport,
      manifest_json: manifest,
      status: overallStatus === "fail" ? "draft" : "active",
    })
    .eq("id", versionId)
    .eq("package_id", packageId)
    .select("id");

  if (updateError) {
    audit.error("network_package_version_ingest_update_failed", {
      packageId,
      versionId,
      userId: user.id,
      message: updateError.message,
      code: updateError.code ?? null,
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    audit.warn("network_package_version_not_found", {
      packageId,
      versionId,
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Network package version not found" },
      { status: 404 }
    );
  }

  audit.info("network_package_version_ingested", {
    packageId,
    versionId,
    userId: user.id,
    workspaceId: pkg.workspace_id,
    overallStatus,
    totalChecks,
    warnings,
    failures,
  });

  if (overallStatus !== "fail") {
    await recordUsageEventBestEffort(
      {
        workspaceId: pkg.workspace_id,
        eventKey: "network_package.ingest",
        bucketKey: "runs",
        weight: QUOTA_WEIGHTS.DEFAULT,
        sourceRoute: "/api/network-packages/[packageId]/versions/[versionId]/ingest",
        idempotencyKey: `network_package:${packageId}:${versionId}:ingest`,
        metadata: { packageId, versionId, overallStatus, totalChecks, warnings, failures },
      },
      audit
    );
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
