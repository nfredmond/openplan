import Link from "next/link";
import { Link2, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import {
  formatDateTime,
  parseStoredScenarioSpineSummary,
  titleize,
} from "@/lib/reports/catalog";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import type { ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import type { ProjectStageGateSnapshot } from "@/lib/stage-gates/summary";
import { driftTone } from "./_helpers";
import type {
  DriftAction,
  DriftItem,
  EngagementCampaignLinkRow,
  LinkedRunRow,
  ProjectRecordSnapshotListItem,
  RunAuditEntry,
} from "./_types";

type EvidenceChainSummary = ReturnType<typeof buildEvidenceChainSummary>;
type StoredScenarioSpineSummary = ReturnType<typeof parseStoredScenarioSpineSummary>;

type Props = {
  runAudit: RunAuditEntry[];
  runs: LinkedRunRow[];
  runTitleById: Map<string, string>;
  sourceContext: Record<string, unknown> | null;
  engagementCampaign: EngagementCampaignLinkRow | null;
  engagementPublicHref: string | null;
  engagementSummaryText: string | null;
  reportOrigin: string | null;
  reportReason: string | null;
  engagementSnapshotCapturedAt: string | null;
  engagementSnapshotTotalItems: number | null;
  engagementSnapshotReadyForHandoff: number | null;
  evidenceChainSummary: EvidenceChainSummary;
  storedScenarioSpineSummary: StoredScenarioSpineSummary;
  projectId: string | null;
  projectUpdatedAt: string | null;
  driftItems: DriftItem[];
  driftActionByKey: Record<string, DriftAction>;
  stageGateSnapshot: ProjectStageGateSnapshot | null;
  projectRecordsSnapshot: ProjectRecordSnapshotListItem[];
  scenarioSetLinks: ReportScenarioSetLink[];
};

export function ReportProvenanceAudit({
  runAudit,
  runs,
  runTitleById,
  sourceContext,
  engagementCampaign,
  engagementPublicHref,
  engagementSummaryText,
  reportOrigin,
  reportReason,
  engagementSnapshotCapturedAt,
  engagementSnapshotTotalItems,
  engagementSnapshotReadyForHandoff,
  evidenceChainSummary,
  storedScenarioSpineSummary,
  projectId,
  projectUpdatedAt,
  driftItems,
  driftActionByKey,
  stageGateSnapshot,
  projectRecordsSnapshot,
  scenarioSetLinks,
}: Props) {
  return (
    <article className="module-section-surface">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Provenance
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Audit trail</h2>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        <p className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Generated artifacts include run-level audit metadata so every packet
          can be traced back to its source analysis and reviewed for
          completeness.
        </p>
        {runAudit.length === 0 ? (
          <EmptyState
            title="No audit data yet"
            description="Generate the report to capture linked-run transparency notes and artifact gate decisions."
            compact
          />
        ) : (
          runAudit.map((item) => (
            <div
              key={item.runId}
              className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">
                    {runTitleById.get(item.runId) ?? `Run ${item.runId.slice(0, 8)}`}
                  </h3>
                  <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                    Gate decision: {item.gate.decision}
                  </p>
                </div>
                <StatusBadge
                  tone={item.gate.decision === "PASS" ? "success" : "warning"}
                >
                  {item.gate.decision}
                </StatusBadge>
              </div>
              {item.gate.missingArtifacts.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {item.gate.missingArtifacts.map((missingArtifact) => (
                    <li
                      key={missingArtifact}
                      className="rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground"
                    >
                      {missingArtifact}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-sm text-muted-foreground">
                  All required artifacts were present for this run.
                </p>
              )}
            </div>
          ))
        )}
      </div>
      {sourceContext || engagementCampaign ? (
        <div id="evidence-chain-summary" className="mt-4 space-y-3">
          <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Evidence chain summary
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quick scan of the source surfaces captured in the latest packet.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Linked runs
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {evidenceChainSummary.linkedRunCount}
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Scenario basis
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {evidenceChainSummary.scenarioSetLinkCount} linked set
                {evidenceChainSummary.scenarioSetLinkCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Scenario spine
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {(storedScenarioSpineSummary?.pendingCount ??
                  evidenceChainSummary.scenarioSharedSpinePendingCount) > 0
                  ? `${storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount} pending set${(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) === 1 ? "" : "s"}`
                  : `${storedScenarioSpineSummary?.assumptionSetCount ?? evidenceChainSummary.scenarioAssumptionSetCount} assumptions · ${storedScenarioSpineSummary?.dataPackageCount ?? evidenceChainSummary.scenarioDataPackageCount} packages · ${storedScenarioSpineSummary?.indicatorSnapshotCount ?? evidenceChainSummary.scenarioIndicatorSnapshotCount} indicators`}
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Project records
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {evidenceChainSummary.totalProjectRecordCount} across{" "}
                {evidenceChainSummary.projectRecordGroupCount} group
                {evidenceChainSummary.projectRecordGroupCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Governance
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {evidenceChainSummary.stageGateLabel} ·{" "}
                {evidenceChainSummary.stageGatePassCount} pass /{" "}
                {evidenceChainSummary.stageGateHoldCount} hold
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-2">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Engagement posture
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {evidenceChainSummary.engagementLabel} ·{" "}
                {evidenceChainSummary.engagementReadyForHandoffCount}/
                {evidenceChainSummary.engagementItemCount} handoff-ready items
              </p>
              {evidenceChainSummary.stageGateBlockedGateLabel ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Blocked gate at generation:{" "}
                  {evidenceChainSummary.stageGateBlockedGateLabel}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Linked evidence
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {String(sourceContext?.linkedRunCount ?? runs.length)} runs,{" "}
                {String(sourceContext?.deliverableCount ?? 0)} deliverables,{" "}
                {String(sourceContext?.decisionCount ?? 0)} decisions
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Source snapshot
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatDateTime(
                  typeof sourceContext?.projectUpdatedAt === "string"
                    ? sourceContext.projectUpdatedAt
                    : projectUpdatedAt
                )}
              </p>
            </div>
            {engagementCampaign ? (
              <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-1">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Engagement source
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {engagementCampaign.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {titleize(engagementCampaign.status)} ·{" "}
                  {titleize(engagementCampaign.engagement_type)} ·{" "}
                  {String(sourceContext?.engagementReadyForHandoffCount ?? 0)} ready for handoff ·{" "}
                  {String(sourceContext?.engagementItemCount ?? 0)} items
                </p>
                {engagementSummaryText ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {engagementSummaryText}
                  </p>
                ) : null}
                {reportOrigin ? (
                  <div className="mt-3 rounded-xl border border-border/60 bg-muted/35 p-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Report origin
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {titleize(reportOrigin)}
                    </p>
                    {reportReason ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {reportReason}
                      </p>
                    ) : null}
                    {engagementSnapshotCapturedAt ||
                    engagementSnapshotReadyForHandoff !== null ||
                    engagementSnapshotTotalItems !== null ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {engagementSnapshotCapturedAt
                          ? `Snapshot captured ${formatDateTime(engagementSnapshotCapturedAt)}`
                          : "Snapshot timing unavailable"}
                        {engagementSnapshotReadyForHandoff !== null
                          ? ` · ${engagementSnapshotReadyForHandoff} ready for handoff`
                          : ""}
                        {engagementSnapshotTotalItems !== null
                          ? ` · ${engagementSnapshotTotalItems} items`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Updated {formatDateTime(engagementCampaign.updated_at)} ·{" "}
                  {engagementPublicHref ? "Public page available" : "Public page unavailable"}
                  {engagementCampaign.allow_public_submissions
                    ? engagementCampaign.submissions_closed_at
                      ? " · Submissions closed"
                      : " · Submissions open"
                    : " · Public submissions disabled"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {driftItems.length > 0 ? (
        <div id="drift-since-generation" className="mt-4 space-y-3">
          <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Drift since generation
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Compact live-vs-snapshot checks for the latest artifact source context.
            </p>
          </div>
          <div className="grid gap-2">
            {driftItems.map((item) => {
              const driftAction = driftActionByKey[item.key] ?? null;

              return (
                <div
                  key={item.key}
                  className="flex flex-col gap-2 rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold tracking-tight text-foreground">
                        {item.label}
                      </p>
                      <StatusBadge tone={driftTone(item.status)}>
                        {item.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                  {driftAction ? (
                    <Link
                      href={driftAction.href}
                      className="inline-flex items-center gap-1 self-start rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {driftAction.label}
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {stageGateSnapshot ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Governance and stage-gate provenance
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Compact stage-gate snapshot persisted with this artifact using the active OpenPlan summary.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Template
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {stageGateSnapshot.templateId}
                  </p>
                </div>
                {projectId ? (
                  <Link
                    href={`/projects/${projectId}#project-governance`}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Open project settings
                  </Link>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Version {stageGateSnapshot.templateVersion} ·{" "}
                {stageGateSnapshot.passCount} pass · {stageGateSnapshot.holdCount} hold ·{" "}
                {stageGateSnapshot.notStartedCount} not started
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Control health
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {stageGateSnapshot.controlHealth.totalOperatorControlEvidenceCount} operator control evidence items
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount} gate
                {stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount === 1 ? "" : "s"} in the active template include operator control evidence.
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Blocked gate
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {stageGateSnapshot.blockedGate
                  ? `${stageGateSnapshot.blockedGate.gateId} · ${stageGateSnapshot.blockedGate.name}`
                  : "No gate on hold"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {stageGateSnapshot.blockedGate
                  ? `${stageGateSnapshot.blockedGate.rationale}${
                      stageGateSnapshot.blockedGate.missingArtifacts.length > 0
                        ? ` Missing artifacts: ${stageGateSnapshot.blockedGate.missingArtifacts.join(", ")}.`
                        : ""
                    }`
                  : "No formal HOLD decision is recorded in this artifact snapshot."}
              </p>
            </div>
            <div className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Next gate
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {stageGateSnapshot.nextGate
                  ? `${stageGateSnapshot.nextGate.gateId} · ${stageGateSnapshot.nextGate.name}`
                  : "Gate sequence complete"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {stageGateSnapshot.nextGate
                  ? `${stageGateSnapshot.nextGate.requiredEvidenceCount} required evidence item${
                      stageGateSnapshot.nextGate.requiredEvidenceCount === 1 ? "" : "s"
                    } · ${stageGateSnapshot.nextGate.operatorControlEvidenceCount} operator control profile${
                      stageGateSnapshot.nextGate.operatorControlEvidenceCount === 1 ? "" : "s"
                    }`
                  : "Every gate in the active template currently has a recorded PASS decision."}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {projectRecordsSnapshot.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project records provenance
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest attached records persisted with this artifact at generation time.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {projectRecordsSnapshot.map((item) => (
              <div
                key={item.key}
                className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {item.value.count} attached
                    </p>
                  </div>
                  {projectId ? (
                    <Link
                      href={`/projects/${projectId}#${item.anchor}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Open {item.label.toLowerCase()}
                    </Link>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.value.latestTitle
                    ? `Latest: ${item.value.latestTitle}${
                        item.value.latestAt
                          ? ` · ${formatDateTime(item.value.latestAt)}`
                          : ""
                      }`
                    : "No attached records in this artifact snapshot."}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {scenarioSetLinks.length > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Scenario basis
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Scenario-set provenance was derived from report-linked runs and persisted with this artifact.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Shared spine totals at generation:{" "}
              {storedScenarioSpineSummary?.assumptionSetCount ??
                evidenceChainSummary.scenarioAssumptionSetCount}{" "}
              assumption set
              {(storedScenarioSpineSummary?.assumptionSetCount ?? evidenceChainSummary.scenarioAssumptionSetCount) === 1 ? "" : "s"}{" "}
              ·{" "}
              {storedScenarioSpineSummary?.dataPackageCount ??
                evidenceChainSummary.scenarioDataPackageCount}{" "}
              data package
              {(storedScenarioSpineSummary?.dataPackageCount ?? evidenceChainSummary.scenarioDataPackageCount) === 1 ? "" : "s"}{" "}
              ·{" "}
              {storedScenarioSpineSummary?.indicatorSnapshotCount ??
                evidenceChainSummary.scenarioIndicatorSnapshotCount}{" "}
              indicator snapshot
              {(storedScenarioSpineSummary?.indicatorSnapshotCount ?? evidenceChainSummary.scenarioIndicatorSnapshotCount) === 1 ? "" : "s"}
              {(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) > 0
                ? ` · ${storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount} pending schema-backed set${(storedScenarioSpineSummary?.pendingCount ?? evidenceChainSummary.scenarioSharedSpinePendingCount) === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
          <div className="grid gap-3">
            {scenarioSetLinks.map((link) => (
              <div
                key={link.scenarioSetId}
                className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight text-foreground">
                      {link.scenarioSetTitle}
                    </h3>
                    <p className="mt-1 text-[0.75rem] uppercase tracking-[0.12em] text-muted-foreground">
                      {link.comparisonSummary.label} · {link.matchedEntries.length} matched entr
                      {link.matchedEntries.length === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      link.comparisonSummary.readyAlternatives > 0
                        ? "success"
                        : link.comparisonSummary.baselineEntryPresent
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {link.comparisonSummary.label}
                  </StatusBadge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Baseline:{" "}
                  <span className="font-medium text-foreground">
                    {link.baselineLabel ?? "Not set"}
                  </span>
                  {link.baselineRunTitle ? ` · ${link.baselineRunTitle}` : ""}
                </p>
                {link.sharedSpine ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {link.sharedSpine.schemaPending
                      ? "Shared scenario spine schema was still pending when this artifact was generated."
                      : `${link.sharedSpine.assumptionSetCount} assumption set${link.sharedSpine.assumptionSetCount === 1 ? "" : "s"} · ${link.sharedSpine.dataPackageCount} data package${link.sharedSpine.dataPackageCount === 1 ? "" : "s"} · ${link.sharedSpine.indicatorSnapshotCount} indicator snapshot${link.sharedSpine.indicatorSnapshotCount === 1 ? "" : "s"} · ${link.sharedSpine.comparisonSnapshotCount} comparison snapshot${link.sharedSpine.comparisonSnapshotCount === 1 ? "" : "s"}`}
                  </p>
                ) : null}
                {link.scenarioSetUpdatedAt || link.latestMatchedEntryUpdatedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {link.scenarioSetUpdatedAt
                      ? `Scenario set updated ${formatDateTime(link.scenarioSetUpdatedAt)}`
                      : "Scenario set timing unavailable"}
                    {link.latestMatchedEntryUpdatedAt
                      ? ` · Matched entries updated ${formatDateTime(link.latestMatchedEntryUpdatedAt)}`
                      : ""}
                    {link.sharedSpine?.latestIndicatorSnapshotAt
                      ? ` · Indicators updated ${formatDateTime(link.sharedSpine.latestIndicatorSnapshotAt)}`
                      : ""}
                    {link.sharedSpine?.latestComparisonSnapshotUpdatedAt
                      ? ` · Comparisons updated ${formatDateTime(link.sharedSpine.latestComparisonSnapshotUpdatedAt)}`
                      : ""}
                  </p>
                ) : null}
                {link.comparisonSnapshots && link.comparisonSnapshots.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {link.comparisonSnapshots.slice(0, 3).map((snapshot) => (
                      <div
                        key={snapshot.comparisonSnapshotId}
                        className="rounded-xl border border-border/70 bg-card px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {snapshot.label}
                          </p>
                          <StatusBadge
                            tone={
                              snapshot.status === "ready"
                                ? "success"
                                : snapshot.status === "archived"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {titleize(snapshot.status)}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {snapshot.candidateEntryLabel
                            ? `${snapshot.candidateEntryLabel} vs ${link.baselineLabel ?? "Baseline"}`
                            : "Saved comparison snapshot"}
                          {snapshot.updatedAt
                            ? ` · Updated ${formatDateTime(snapshot.updatedAt)}`
                            : ""}
                          {` · ${snapshot.indicatorDeltaCount} indicator delta${snapshot.indicatorDeltaCount === 1 ? "" : "s"}`}
                        </p>
                        {snapshot.summary ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {snapshot.summary}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/scenarios/${link.scenarioSetId}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.72rem] font-medium text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Open scenario set
                  </Link>
                </div>
                <div className="mt-3 grid gap-2">
                  {link.matchedEntries.map((entry) => (
                    <div
                      key={entry.entryId}
                      className="rounded-xl border border-border/70 bg-card px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {entry.label}
                        </p>
                        <StatusBadge
                          tone={entry.comparisonReady ? "success" : "warning"}
                        >
                          {entry.comparisonLabel}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {titleize(entry.entryType)}
                        {entry.attachedRunTitle
                          ? ` · ${entry.attachedRunTitle}`
                          : " · Run unavailable"}
                        {entry.runCreatedAt
                          ? ` · Run ${formatDateTime(entry.runCreatedAt)}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
