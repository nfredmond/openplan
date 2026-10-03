import type { summarizeEngagementItems } from "@/lib/engagement/summary";
import { ChartShareBar } from "@/components/ui/chart-share-bar";
import type { HotspotAnalysis } from "@/lib/engagement/hotspots";
import type { IntakeTrend } from "@/lib/engagement/participation-dashboard";

type EngagementCounts = ReturnType<typeof summarizeEngagementItems>;

/** A labelled bar whose meaning is carried by the label and the count, so it
 * stays legible if colour is desaturated (design-constitution test). */
function Bar({
  label,
  count,
  sharePct,
  colorHex,
}: {
  label: string;
  count: number;
  sharePct: number;
  /** A category's own colour, chosen by the planner. Other rows use the palette. */
  colorHex?: string | null;
}) {
  return (
    <ChartShareBar
      label={label}
      valueText={`${count} · ${Math.round(sharePct)}%`}
      fraction={sharePct / 100}
      colorHex={colorHex}
    />
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

// One colour for every status: green against red fails colour-blind separation
// on this palette (see chart-primitives.tsx), and the label already says which.
const STATUS_ROWS: Array<{ key: "approved" | "pending" | "flagged" | "rejected"; label: string }> = [
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Pending" },
  { key: "flagged", label: "Flagged" },
  { key: "rejected", label: "Rejected" },
];

function IntakeSparkline({ intake }: { intake: IntakeTrend }) {
  const { buckets, peak } = intake;
  const n = buckets.length;
  return (
    <svg
      viewBox={`0 0 ${n * 4} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Intake over the last ${intake.windowDays} days, ${intake.total} contributions`}
      className="h-12 w-full text-muted-foreground"
    >
      {buckets.map((b, i) => {
        const h = peak > 0 ? Math.max(b.count > 0 ? 2 : 0.5, (b.count / peak) * 36) : 0.5;
        return (
          <rect key={b.date} x={i * 4} y={40 - h} width={3} height={h} rx={0.5} className="fill-current opacity-60" />
        );
      })}
    </svg>
  );
}

export function ParticipationDashboard({
  counts,
  categories,
  hotspots,
  intake,
}: {
  counts: EngagementCounts;
  categories: Array<{ id: string; label: string | null; color?: string | null }>;
  hotspots: HotspotAnalysis;
  intake: IntakeTrend;
}) {
  const total = counts.totalItems;
  const colorById = new Map(categories.map((c) => [c.id, c.color ?? null]));
  const topCategories = [...counts.categoryCounts].sort((a, b) => b.count - a.count).slice(0, 6);
  const geo = counts.geographyCoverage;
  const topClusters = hotspots.clusters.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Intake trend */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <SubLabel>Intake — last {intake.windowDays} days</SubLabel>
          <span className="text-xs text-muted-foreground">
            {intake.total} contribution{intake.total === 1 ? "" : "s"}
            {intake.peak > 0 ? ` · peak ${intake.peak}/day` : ""}
          </span>
        </div>
        <IntakeSparkline intake={intake} />
      </div>

      {/* Status + geography */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <SubLabel>Moderation status</SubLabel>
          {total > 0 ? (
            STATUS_ROWS.map((row) => (
              <Bar
                key={row.key}
                label={row.label}
                count={counts.statusCounts[row.key]}
                sharePct={(counts.statusCounts[row.key] / total) * 100}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No contributions yet.</p>
          )}
        </div>
        <div className="space-y-3">
          <SubLabel>Map coverage</SubLabel>
          <Bar
            label="Geolocated"
            count={geo.geolocatedItems}
            sharePct={geo.geolocatedShare * 100}
          />
          <Bar
            label="No location"
            count={geo.nonGeolocatedItems}
            sharePct={total > 0 ? (geo.nonGeolocatedItems / total) * 100 : 0}
          />
          <p className="text-label leading-relaxed text-muted-foreground">
            Only geolocated, approved comments feed the heatmap and the spatial hotspot test.
          </p>
        </div>
      </div>

      {/* Category mix */}
      {topCategories.length > 0 ? (
        <div className="space-y-3">
          <SubLabel>Top categories</SubLabel>
          {topCategories.map((cat) => (
            <Bar
              key={cat.categoryId ?? "uncategorized"}
              label={cat.label}
              count={cat.count}
              sharePct={cat.shareOfItems * 100}
              colorHex={cat.categoryId ? colorById.get(cat.categoryId) : null}
            />
          ))}
        </div>
      ) : null}

      {/* Spatial hotspots */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <SubLabel>Spatial hotspots</SubLabel>
          <span className="text-xs text-muted-foreground">
            {hotspots.clusterCount} cluster{hotspots.clusterCount === 1 ? "" : "s"}
            {hotspots.sentimentAvailable && hotspots.globalNegativeSharePct !== null
              ? ` · ${hotspots.significantCount} elevated-concern · ${hotspots.globalNegativeSharePct}% baseline negative`
              : ""}
          </span>
        </div>

        {hotspots.clusterCount === 0 ? (
          <p className="text-xs text-muted-foreground">
            No spatial clusters at the current density ({hotspots.epsMeters} m / {hotspots.minPoints} min points). Clusters
            appear once approved, geolocated comments concentrate.
          </p>
        ) : (
          <div className="space-y-2">
            {!hotspots.sentimentAvailable ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Sentiment is unassessed without earlier source-linked labels. New AI sentiment generation is not yet available.
              </p>
            ) : null}
            {topClusters.map((cluster, index) => {
              const tone = cluster.significant
                ? "text-red-700 dark:text-red-300"
                : "text-muted-foreground";
              const marker = cluster.significant
                ? "Elevated concern (screening)"
                : cluster.testable
                  ? "Within baseline"
                  : "Too few for a significance call";
              return (
                <div key={cluster.clusterId} className="border-l-2 border-border/60 pl-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Cluster {index + 1}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {cluster.zScore !== null ? (
                        <span className={tone}>z = {cluster.zScore.toFixed(2)}</span>
                      ) : (
                        <span>{cluster.nItems} comments</span>
                      )}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {cluster.nItems} comment{cluster.nItems === 1 ? "" : "s"}
                    {cluster.clusterNegativeSharePct !== null && hotspots.globalNegativeSharePct !== null
                      ? ` · ${cluster.clusterNegativeSharePct}% negative vs ${hotspots.globalNegativeSharePct}% baseline`
                      : ""}
                    {" · "}
                    <span className={tone}>{marker}</span>
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-label leading-relaxed text-muted-foreground">{hotspots.caveat}</p>
      </div>
    </div>
  );
}
