import type { CountyRunModelingEvidence } from "@/lib/api/county-onramp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";

type ClaimStatus = NonNullable<CountyRunModelingEvidence["claimDecision"]>["claimStatus"];

function claimStatusLabel(status: ClaimStatus) {
  switch (status) {
    case "claim_grade_passed":
      return "Claim-grade";
    case "screening_grade":
      return "Screening-grade";
    case "prototype_only":
      return "Prototype-only";
    default:
      return "Unknown";
  }
}

function claimStatusTone(status: string | null | undefined): StatusTone {
  if (status === "claim_grade_passed") return "success";
  if (status === "screening_grade") return "warning";
  if (status === "prototype_only") return "neutral";
  return "info";
}

function validationTone(status: string): StatusTone {
  if (status === "pass") return "success";
  if (status === "warn") return "warning";
  return "danger";
}

function formatValue(value: number | null) {
  if (value === null) return "-";
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function CountyRunModelingEvidence({ evidence }: { evidence?: CountyRunModelingEvidence | null }) {
  if (!evidence || (!evidence.claimDecision && evidence.validationResults.length === 0 && evidence.sourceManifests.length === 0)) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Modeling evidence</CardTitle>
          <CardDescription>Structured assignment evidence has not been written for this county run yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const claimDecision = evidence.claimDecision;
  const passed = evidence.validationResults.filter((result) => result.status === "pass").length;
  const warned = evidence.validationResults.filter((result) => result.status === "warn").length;
  const failed = evidence.validationResults.filter((result) => result.status === "fail").length;

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Modeling evidence</CardTitle>
          {claimDecision ? (
            <StatusBadge tone={claimStatusTone(claimDecision.claimStatus)}>
              {claimStatusLabel(claimDecision.claimStatus)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="info">No claim decision</StatusBadge>
          )}
        </div>
        <CardDescription>
          {evidence.reportLanguage ?? "Validation rows are present, but no assignment claim decision is recorded."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {claimDecision ? (
          <div className="rounded-lg border border-border/70 p-3 text-sm">
            <div className="font-medium text-foreground">{claimDecision.statusReason}</div>
            {claimDecision.reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {claimDecision.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Validation</div>
            <div className="mt-1 font-medium text-foreground">
              {passed} pass / {warned} warn / {failed} fail
            </div>
          </div>
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Sources</div>
            <div className="mt-1 font-medium text-foreground">{evidence.sourceManifests.length} public inputs</div>
          </div>
          <div className="rounded-lg border border-border/70 p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Track</div>
            <div className="mt-1 font-medium text-foreground">{claimDecision?.track ?? "assignment"}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Validation checks</div>
          {evidence.validationResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">No validation rows are recorded.</p>
          ) : (
            <div className="divide-y divide-border/70 rounded-lg border border-border/70">
              {evidence.validationResults.map((result) => (
                <div key={result.id} className="grid gap-3 p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <div className="font-medium text-foreground">{result.metricLabel}</div>
                    <p className="mt-1 text-muted-foreground">{result.detail}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <StatusBadge tone={validationTone(result.status)}>{result.status}</StatusBadge>
                    <span className="text-muted-foreground">
                      {formatValue(result.observedValue)}
                      {result.thresholdValue !== null ? ` / ${result.thresholdComparator} ${formatValue(result.thresholdValue)}` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Source manifest</div>
          {evidence.sourceManifests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No source manifests are recorded.</p>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {evidence.sourceManifests.map((source) => (
                <div key={source.id} className="rounded-lg border border-border/70 p-3 text-sm">
                  <div className="font-medium text-foreground">{source.sourceLabel}</div>
                  <div className="mt-1 text-muted-foreground">{source.citationText}</div>
                  <div className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {[source.sourceKind, source.sourceVintage, source.geographyLabel].filter(Boolean).join(" / ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
