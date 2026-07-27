import { Network } from "lucide-react";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { StateBlock } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import { formatModelDateTime } from "@/lib/models/catalog";
import { looksLikePendingSchema } from "@/lib/models/run-launch";
import type { StatusTone } from "@/lib/ui/status";

type NetworkPackageRow = {
  id: string;
  name: string;
  description: string | null;
  region_code: string | null;
  bbox: unknown;
  updated_at: string | null;
};

type NetworkPackageVersionRow = {
  id: string;
  package_id: string;
  version_name: string;
  status: string;
  created_at: string | null;
};

function versionStatusTone(status: string): StatusTone {
  if (status === "active") return "success";
  if (status === "archived") return "neutral";
  return "info";
}

/** A count is a number, or null when the count query failed — rendered as
 * "not counted", never as a fake zero. */
function formatComponentCount(count: number | null): string {
  return count === null ? "?" : String(count);
}

const INGEST_HOW_TO =
  "Ingest is API-only for now — there is no in-app upload form yet. Create a package with POST /api/network-packages, add a version with POST /api/network-packages/{packageId}/versions, then send nodes/links GeoJSON to POST /api/network-packages/{packageId}/versions/{versionId}/ingest to run QA checks and store the bundle.";

export async function NetworkPackagesPanel({ workspaceId }: { workspaceId: string }) {
  const supabase = await createClient();

  const packagesResult = await supabase
    .from("network_packages")
    .select("id, name, description, region_code, bbox, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  const schemaPending = Boolean(packagesResult.error && looksLikePendingSchema(packagesResult.error.message));

  if (packagesResult.error && !schemaPending) {
    return (
      <article id="network-packages" className="module-section-surface">
        <StateBlock
          tone="warning"
          title="Network packages could not be loaded"
          description="The workspace's network package records did not load. Retry, and if this persists check the deployment's database logs — this panel refuses to present a load failure as an empty catalog."
        />
      </article>
    );
  }

  const packages = (packagesResult.data ?? []) as NetworkPackageRow[];
  const packageIds = packages.map((pkg) => pkg.id);

  const versionsResult = packageIds.length
    ? await supabase
        .from("network_package_versions")
        .select("id, package_id, version_name, status, created_at")
        .in("package_id", packageIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  const versions = (versionsResult.data ?? []) as NetworkPackageVersionRow[];
  const versionCountByPackage = new Map<string, number>();
  const latestVersionByPackage = new Map<string, NetworkPackageVersionRow>();
  for (const version of versions) {
    versionCountByPackage.set(version.package_id, (versionCountByPackage.get(version.package_id) ?? 0) + 1);
    // versions are ordered newest-first, so the first row per package is the latest.
    if (!latestVersionByPackage.has(version.package_id)) {
      latestVersionByPackage.set(version.package_id, version);
    }
  }

  const latestVersionIds = Array.from(latestVersionByPackage.values()).map((version) => version.id);

  // Exact HEAD counts per latest version. Row-fetch tallies were rejected:
  // PostgREST caps responses at max_rows (1000 locally), which would present
  // a truncated tally as a real count for any real-sized network.
  const countByVersion = async (table: string): Promise<Map<string, number | null>> => {
    const entries = await Promise.all(
      latestVersionIds.map(async (versionId) => {
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("package_version_id", versionId);
        return [versionId, error ? null : (count ?? 0)] as const;
      })
    );
    return new Map(entries);
  };

  const [zoneCounts, corridorCounts, connectorCounts] = latestVersionIds.length
    ? await Promise.all([
        countByVersion("network_zones"),
        countByVersion("network_corridors"),
        countByVersion("network_connectors"),
      ])
    : [new Map<string, number | null>(), new Map<string, number | null>(), new Map<string, number | null>()];

  return (
    <article id="network-packages" className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Network basis</p>
          <h2 className="module-section-title">Network packages</h2>
          <p className="module-section-description">
            Versioned network bundles ingested for this workspace — the zones, corridors, and connectors a model run can be
            read against. A model records its network basis via the model update API; each model&apos;s detail page shows
            the version it is bound to.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Network className="h-3.5 w-3.5" />
          {schemaPending ? "schema pending" : `${packages.length} total`}
        </span>
      </div>

      {schemaPending ? (
        <div className="mt-5">
          <StateBlock
            tone="warning"
            title="Network package schema pending"
            description="The network package tables are not present in this deployment's database yet. Apply the latest migrations to enable this panel."
          />
        </div>
      ) : packages.length === 0 ? (
        <div className="mt-5">
          <StateBlock
            tone="neutral"
            title="No network packages ingested yet"
            description={INGEST_HOW_TO}
          />
        </div>
      ) : (
        <div className="mt-5 module-record-list">
          {packages.map((pkg) => {
            const latestVersion = latestVersionByPackage.get(pkg.id) ?? null;
            const versionCount = versionCountByPackage.get(pkg.id) ?? 0;

            return (
              <div key={pkg.id} className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      {latestVersion ? (
                        <StatusBadge tone={versionStatusTone(latestVersion.status)}>
                          {latestVersion.version_name} · {latestVersion.status}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">No versions yet</StatusBadge>
                      )}
                      {pkg.region_code ? <StatusBadge tone="info">{pkg.region_code}</StatusBadge> : null}
                    </div>
                    <h3 className="module-record-title">{pkg.name}</h3>
                    <p className="module-record-summary">
                      {pkg.description ||
                        "No description recorded. The ingest QA report and manifest live on each version."}
                    </p>
                  </div>
                </div>
                <MetaList>
                  <MetaItem>
                    {versionCount} version{versionCount === 1 ? "" : "s"}
                  </MetaItem>
                  <MetaItem>{pkg.bbox ? "Bounding box on file" : "No bounding box"}</MetaItem>
                  {latestVersion ? (
                    <MetaItem>
                      Latest: {formatComponentCount(zoneCounts.get(latestVersion.id) ?? null)} zones ·{" "}
                      {formatComponentCount(corridorCounts.get(latestVersion.id) ?? null)} corridors ·{" "}
                      {formatComponentCount(connectorCounts.get(latestVersion.id) ?? null)} connectors
                    </MetaItem>
                  ) : null}
                  <MetaItem>Updated {formatModelDateTime(pkg.updated_at)}</MetaItem>
                </MetaList>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
