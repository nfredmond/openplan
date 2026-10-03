import { ChartShareBar } from "@/components/ui/chart-share-bar";
import { DEMOGRAPHIC_DIMENSIONS } from "@/lib/engagement/demographics";
import type {
  DemographicsSummary,
  SelfReportedDemographicsSource,
} from "@/lib/engagement/demographics";

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/**
 * The panel takes the SOURCE rather than the summary because the empty summary
 * and the failed read used to arrive here identical. "No respondents have shared
 * optional demographics yet" is a sentence about the community; a permission
 * error or a dropped RPC must never be allowed to say it.
 */
export function DemographicsPanel({ source }: { source: SelfReportedDemographicsSource }) {
  if (source.state === "unreadable") {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-300">
        Respondent demographics could not be read, so this panel is unavailable rather than empty — an absence here
        would not mean no one answered. Reported cause: {source.message}
      </p>
    );
  }

  if (source.state === "not_collected") {
    return (
      <p className="text-xs text-muted-foreground">
        This campaign is not collecting optional demographics, so nothing is known about who responded.
      </p>
    );
  }

  if (source.state === "not_loaded") {
    return (
      <p className="text-xs text-muted-foreground">
        Respondent demographics were not loaded for this view.
      </p>
    );
  }

  const summary: DemographicsSummary = source.summary;

  if (!summary.hasAny) {
    return (
      <p className="text-xs text-muted-foreground">
        No respondents have shared optional demographics yet. Bands appear once at least a few respondents answer
        (small groups are suppressed).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {summary.respondentsWithDemographics} respondent{summary.respondentsWithDemographics === 1 ? "" : "s"} shared
        optional demographics.
        {summary.hasSuppressed ? " Small groups (fewer than 5) are collapsed into “Small groups (suppressed).”" : ""}
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {DEMOGRAPHIC_DIMENSIONS.map((dimension) => {
          const bands = summary.dimensions[dimension.key];
          if (bands.length === 0) return null;
          const max = bands.reduce((acc, band) => Math.max(acc, band.count), 0);
          return (
            <div key={dimension.key} className="space-y-2">
              <SubLabel>{dimension.label}</SubLabel>
              {bands.map((band) => (
                <ChartShareBar
                  key={band.band}
                  label={band.label}
                  // A count, not a share: suppression and multi-select make a
                  // percentage misleading, so the bar is scaled to the largest band.
                  valueText={String(band.count)}
                  fraction={max > 0 ? band.count / max : 0}
                  tone={band.band === "suppressed" ? "reference" : "series"}
                />
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-label leading-relaxed text-muted-foreground">{summary.caveat}</p>
    </div>
  );
}
