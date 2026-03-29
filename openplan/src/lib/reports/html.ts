import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import { type ProjectStageGateSnapshot } from "@/lib/stage-gates/summary";
import { formatDateTime, formatReportTypeLabel, titleize } from "@/lib/reports/catalog";
import {
  extractEngagementHandoffProvenance,
  type ReportEngagementSummary,
} from "@/lib/reports/engagement";
import { type ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";

type ProjectRecord = {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
};

type RunRecord = {
  id: string;
  title: string;
  query_text: string;
  summary_text: string | null;
  ai_interpretation: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
};

type ProjectItem = {
  id: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  at?: string | null;
};

type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

type ReportSectionRecord = {
  id: string;
  section_key: string;
  title: string;
  enabled: boolean;
  sort_order: number;
  config_json: Record<string, unknown> | null;
};

export type ReportGenerationData = {
  report: {
    id: string;
    title: string;
    summary: string | null;
    report_type: string;
    created_at: string;
  };
  workspace: {
    id: string;
    name: string;
    plan: string | null;
  } | null;
  project: ProjectRecord;
  runs: RunRecord[];
  sections: ReportSectionRecord[];
  deliverables: ProjectItem[];
  risks: ProjectItem[];
  issues: ProjectItem[];
  decisions: ProjectItem[];
  meetings: ProjectItem[];
  engagement: ReportEngagementSummary | null;
  scenarioSetLinks: ReportScenarioSetLink[];
  projectRecordsSnapshot: {
    deliverables: ProjectRecordSnapshotEntry;
    risks: ProjectRecordSnapshotEntry;
    issues: ProjectRecordSnapshotEntry;
    decisions: ProjectRecordSnapshotEntry;
    meetings: ProjectRecordSnapshotEntry;
  };
  stageGateSnapshot: ProjectStageGateSnapshot;
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function listMarkup(items: ProjectItem[], emptyMessage: string): string {
  if (items.length === 0) {
    return `<p class="empty">${esc(emptyMessage)}</p>`;
  }

  return `<ul class="record-list">${items
    .map((item) => {
      const meta = [item.status ? titleize(item.status) : null, item.at ? formatDateTime(item.at) : null]
        .filter(Boolean)
        .join(" • ");

      return `<li>
        <strong>${esc(item.title)}</strong>
        ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ""}
      </li>`;
    })
    .join("")}</ul>`;
}

function timelineMarkup(data: ReportGenerationData): string {
  const items = [
    ...data.deliverables.map((item) => ({ ...item, kind: "Deliverable" })),
    ...data.risks.map((item) => ({ ...item, kind: "Risk" })),
    ...data.issues.map((item) => ({ ...item, kind: "Issue" })),
    ...data.decisions.map((item) => ({ ...item, kind: "Decision" })),
    ...data.meetings.map((item) => ({ ...item, kind: "Meeting" })),
  ]
    .sort((left, right) => {
      const leftTime = left.at ? new Date(left.at).getTime() : 0;
      const rightTime = right.at ? new Date(right.at).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 12);

  if (items.length === 0) {
    return `<p class="empty">No project activity is attached yet.</p>`;
  }

  return `<ol class="timeline">${items
    .map(
      (item) => `<li>
        <span class="meta">${esc(item.kind)} • ${esc(formatDateTime(item.at))}</span>
        <strong>${esc(item.title)}</strong>
        ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
      </li>`
    )
    .join("")}</ol>`;
}

function runMarkup(run: RunRecord): string {
  const metrics = run.metrics ?? {};
  const gate = evaluateReportArtifactGate(run);
  const transparency = buildSourceTransparency(metrics, typeof run.ai_interpretation === "string" ? "ai" : "fallback");
  const score = typeof metrics.overallScore === "number" ? `${metrics.overallScore}/100` : "N/A";
  const confidence = typeof metrics.confidence === "string" ? titleize(metrics.confidence) : "Unknown";

  return `<article class="run-card">
    <div class="run-head">
      <div>
        <h3>${esc(run.title)}</h3>
        <p class="meta">Run created ${esc(formatDateTime(run.created_at))}</p>
      </div>
      <span class="pill ${gate.decision === "PASS" ? "pill-pass" : "pill-hold"}">${gate.decision}</span>
    </div>
    <p>${esc(run.summary_text || "No run summary is saved yet.")}</p>
    <div class="metrics-grid">
      <div><span class="metric-label">Overall score</span><strong>${esc(score)}</strong></div>
      <div><span class="metric-label">Confidence</span><strong>${esc(confidence)}</strong></div>
    </div>
    <div class="transparency-grid">
      ${transparency
        .map(
          (item) => `<div class="transparency-item">
            <strong>${esc(item.label)}</strong>
            <span class="meta">${esc(item.status)}</span>
            <p>${esc(item.detail)}</p>
          </div>`
        )
        .join("")}
    </div>
    ${
      gate.missingArtifacts.length > 0
        ? `<div class="warning-box"><strong>Audit hold.</strong><p>Missing report artifacts: ${esc(gate.missingArtifacts.join(", "))}</p></div>`
        : ""
    }
    <details>
      <summary>Analysis query</summary>
      <p>${esc(run.query_text)}</p>
    </details>
  </article>`;
}

function engagementHandoffMarkup(data: ReportGenerationData): string {
  const provenance = extractEngagementHandoffProvenance(data.sections);
  if (!provenance) {
    return "";
  }

  const currentCounts = data.engagement?.counts ?? null;

  return `<div class="warning-box" style="margin-top: 18px;">
    <strong>Report origin: ${esc(titleize(provenance.origin))}</strong>
    <p>${esc(provenance.reason)}</p>
    <p>Created from <strong>${esc(provenance.campaign.title)}</strong> and snapshot captured ${esc(
      formatDateTime(provenance.capturedAt)
    )}.</p>
    <p>Handoff snapshot: ${provenance.counts.readyForHandoffCount} ready for handoff • ${provenance.counts.totalItems} total items • ${provenance.counts.actionableCount} actionable review • ${provenance.counts.uncategorizedItems} uncategorized.</p>
    ${
      currentCounts
        ? `<p>Current live campaign counts: ${currentCounts.moderationQueue.readyForHandoffCount} ready for handoff • ${currentCounts.totalItems} total items.</p>`
        : ""
    }
  </div>`;
}

function projectRecordsProvenanceMarkup(data: ReportGenerationData): string {
  const entries: Array<{
    label: string;
    anchor: string;
    value: ProjectRecordSnapshotEntry;
  }> = [
    { label: "Deliverables", anchor: "project-deliverables", value: data.projectRecordsSnapshot.deliverables },
    { label: "Risks", anchor: "project-risks", value: data.projectRecordsSnapshot.risks },
    { label: "Issues", anchor: "project-issues", value: data.projectRecordsSnapshot.issues },
    { label: "Decisions", anchor: "project-decisions", value: data.projectRecordsSnapshot.decisions },
    { label: "Meetings", anchor: "project-meetings", value: data.projectRecordsSnapshot.meetings },
  ];

  return `<section>
    <h2 class="section-title">Project records provenance</h2>
    <p>This artifact includes a compact snapshot of attached project records captured at generation time so reviewers can see the latest named evidence behind the packet.</p>
    <div class="metrics-stack">
      ${entries
        .map(
          ({ label, anchor, value }) => `<article class="metric-card">
            <span class="metric-label">${esc(label)}</span>
            <strong>${value.count}</strong>
            <p>${
              value.latestTitle
                ? `Latest: ${esc(value.latestTitle)}${
                    value.latestAt ? ` • ${esc(formatDateTime(value.latestAt))}` : ""
                  }`
                : "No attached records in this snapshot."
            }</p>
            <p><a href="/projects/${esc(data.project.id)}#${esc(anchor)}">Open ${esc(label.toLowerCase())}</a></p>
          </article>`
        )
        .join("")}
    </div>
  </section>`;
}

function stageGateProvenanceMarkup(data: ReportGenerationData): string {
  const { stageGateSnapshot } = data;
  const blockedGate = stageGateSnapshot.blockedGate;
  const nextGate = stageGateSnapshot.nextGate;

  return `<section>
    <h2 class="section-title">Governance and stage-gate provenance</h2>
    <p>This artifact includes a compact stage-gate snapshot captured at generation time using the active OpenPlan stage-gate summary.</p>
    <div class="metrics-stack">
      <article class="metric-card">
        <span class="metric-label">Template</span>
        <strong>${esc(stageGateSnapshot.templateId)}</strong>
        <p>Version ${esc(stageGateSnapshot.templateVersion)} • ${stageGateSnapshot.passCount} pass • ${stageGateSnapshot.holdCount} hold • ${stageGateSnapshot.notStartedCount} not started</p>
        <p><a href="/projects/${esc(data.project.id)}#project-governance">Open governance</a></p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Blocked gate</span>
        <strong>${esc(blockedGate ? `${blockedGate.gateId} · ${blockedGate.name}` : "No gate on hold")}</strong>
        <p>${
          blockedGate
            ? `${esc(blockedGate.rationale)}${
                blockedGate.missingArtifacts.length > 0
                  ? ` Missing artifacts: ${esc(blockedGate.missingArtifacts.join(", "))}.`
                  : ""
              }`
            : "No formal HOLD decision is recorded in this snapshot."
        }</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Next gate</span>
        <strong>${esc(nextGate ? `${nextGate.gateId} · ${nextGate.name}` : "Gate sequence complete")}</strong>
        <p>${
          nextGate
            ? `${nextGate.requiredEvidenceCount} required evidence item${
                nextGate.requiredEvidenceCount === 1 ? "" : "s"
              } • ${nextGate.operatorControlEvidenceCount} operator control profile${
                nextGate.operatorControlEvidenceCount === 1 ? "" : "s"
              }`
            : "Every gate in the active template currently has a recorded PASS decision."
        }</p>
      </article>
      <article class="metric-card">
        <span class="metric-label">Control health</span>
        <strong>${stageGateSnapshot.controlHealth.totalOperatorControlEvidenceCount}</strong>
        <p>${stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount} gate${
          stageGateSnapshot.controlHealth.gatesWithOperatorControlsCount === 1 ? "" : "s"
        } in this template include operator control evidence.</p>
      </article>
    </div>
  </section>`;
}

function scenarioBasisMarkup(data: ReportGenerationData): string {
  if (data.scenarioSetLinks.length === 0) {
    return "";
  }

  return `<section>
    <h2 class="section-title">Scenario basis</h2>
    <p>This packet includes scenario provenance derived from report-linked runs and scenario entries.</p>
    <div class="metrics-stack">
      ${data.scenarioSetLinks
        .map((link) => {
          const matchedEntries = link.matchedEntries
            .map((entry) => {
              const runMeta = [entry.attachedRunTitle, entry.runCreatedAt ? `Run ${formatDateTime(entry.runCreatedAt)}` : null]
                .filter(Boolean)
                .join(" • ");

              return `<li>
                <strong>${esc(entry.label)}</strong>
                <p>${esc(titleize(entry.entryType))} • ${esc(entry.comparisonLabel)}</p>
                ${runMeta ? `<span class="meta">${esc(runMeta)}</span>` : ""}
              </li>`;
            })
            .join("");

          const snapshotMeta = [
            link.scenarioSetUpdatedAt ? `Scenario set updated ${formatDateTime(link.scenarioSetUpdatedAt)}` : null,
            link.latestMatchedEntryUpdatedAt ? `Matched entries updated ${formatDateTime(link.latestMatchedEntryUpdatedAt)}` : null,
          ]
            .filter(Boolean)
            .join(" • ");

          return `<article class="metric-card">
            <h3>${esc(link.scenarioSetTitle)}</h3>
            <p>Comparison posture: <strong>${esc(link.comparisonSummary.label)}</strong></p>
            <p>Baseline: <strong>${esc(link.baselineLabel ?? "Not set")}</strong>${
              link.baselineRunTitle ? ` • ${esc(link.baselineRunTitle)}` : ""
            }</p>
            ${snapshotMeta ? `<p class="meta">${esc(snapshotMeta)}</p>` : ""}
            <p><a href="/scenarios/${esc(link.scenarioSetId)}">Open scenario set</a></p>
            <ul class="record-list" style="margin-top: 12px;">${matchedEntries}</ul>
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

function sectionMarkup(sectionKey: string, data: ReportGenerationData): string {
  if (sectionKey === "project_overview" || sectionKey === "cover_page") {
    return `<div class="two-col">
      <div>
        <h3>${esc(data.project.name)}</h3>
        <p>${esc(data.project.summary || "No project summary recorded yet.")}</p>
      </div>
      <dl class="facts">
        <div><dt>Report type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
        <div><dt>Workspace</dt><dd>${esc(data.workspace?.name ?? "Unknown")}</dd></div>
        <div><dt>Plan tier</dt><dd>${esc(titleize(data.workspace?.plan ?? "pilot"))}</dd></div>
        <div><dt>Generated basis</dt><dd>Project records + linked runs</dd></div>
      </dl>
    </div>`;
  }

  if (sectionKey === "status_snapshot" || sectionKey === "executive_summary") {
    return `<div class="metrics-grid">
      <div><span class="metric-label">Project status</span><strong>${esc(titleize(data.project.status))}</strong></div>
      <div><span class="metric-label">Plan type</span><strong>${esc(titleize(data.project.plan_type))}</strong></div>
      <div><span class="metric-label">Delivery phase</span><strong>${esc(titleize(data.project.delivery_phase))}</strong></div>
      <div><span class="metric-label">Linked runs</span><strong>${data.runs.length}</strong></div>
    </div>
    <p>${esc(data.report.summary || data.project.summary || "No executive summary has been authored yet. This packet reflects current structured records and linked run evidence only.")}</p>
    ${engagementHandoffMarkup(data)}`;
  }

  if (sectionKey === "deliverables") {
    return listMarkup(data.deliverables, "No deliverables are attached yet.");
  }

  if (sectionKey === "risks_issues") {
    return `<div class="two-col">
      <div>
        <h3>Risks</h3>
        ${listMarkup(data.risks, "No project risks recorded.")}
      </div>
      <div>
        <h3>Issues</h3>
        ${listMarkup(data.issues, "No project issues recorded.")}
      </div>
    </div>`;
  }

  if (sectionKey === "decisions_meetings" || sectionKey === "project_records_digest") {
    return `<div class="two-col">
      <div>
        <h3>Decisions</h3>
        ${listMarkup(data.decisions, "No project decisions recorded.")}
      </div>
      <div>
        <h3>Meetings</h3>
        ${listMarkup(data.meetings, "No project meetings recorded.")}
      </div>
    </div>`;
  }

  if (sectionKey === "activity_timeline") {
    return timelineMarkup(data);
  }

  if (sectionKey === "run_summaries" || sectionKey === "analysis_summaries") {
    return data.runs.length > 0
      ? data.runs.map((run) => runMarkup(run)).join("")
      : `<p class="empty">No analysis runs are attached to this report yet.</p>`;
  }

  if (sectionKey === "key_metrics" || sectionKey === "artifacts_context") {
    return data.runs.length > 0
      ? `<div class="metrics-stack">${data.runs
          .map((run) => {
            const metrics = run.metrics ?? {};
            const metricsRows = [
              ["Overall score", typeof metrics.overallScore === "number" ? `${metrics.overallScore}/100` : "N/A"],
              ["Accessibility", typeof metrics.accessibilityScore === "number" ? `${metrics.accessibilityScore}/100` : "N/A"],
              ["Safety", typeof metrics.safetyScore === "number" ? `${metrics.safetyScore}/100` : "N/A"],
              ["Equity", typeof metrics.equityScore === "number" ? `${metrics.equityScore}/100` : "N/A"],
            ];

            return `<article class="metric-card">
              <h3>${esc(run.title)}</h3>
              <dl class="facts">
                ${metricsRows
                  .map(
                    ([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`
                  )
                  .join("")}
              </dl>
            </article>`;
          })
          .join("")}</div>`
      : `<p class="empty">No linked analysis metrics are available.</p>`;
  }

  if (sectionKey === "methods_assumptions" || sectionKey === "assumptions_provenance" || sectionKey === "appendix_references") {
    return `<div class="warning-box">
      <strong>Auditability posture</strong>
      <p>This report is a structured packet assembled from current OpenPlan project records and linked analysis runs. Reviewers should treat it as evidence-backed output, not freeform narrative copy.</p>
      <p>Generated on ${esc(formatDateTime(new Date().toISOString()))}. Project last updated ${esc(formatDateTime(data.project.updated_at))}. Review run-level transparency notes before external release.</p>
    </div>`;
  }

  if (sectionKey === "engagement_summary") {
    if (!data.engagement) {
      return `<p class="empty">No engagement campaign is configured for this report section.</p>`;
    }

    const { campaign, counts } = data.engagement;
    const topCategories = counts.categoryCounts
      .filter((category) => category.categoryId !== null && category.count > 0)
      .slice(0, 4);
    const topSources = [...counts.sourceSummaries]
      .filter((source) => source.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 4);

    return `<div class="two-col">
      <div>
        <h3>${esc(campaign.title)}</h3>
        <p>${esc(campaign.summary || "No campaign summary recorded yet.")}</p>
        <div class="metrics-grid" style="margin-top: 14px;">
          <div><span class="metric-label">Campaign status</span><strong>${esc(titleize(campaign.status))}</strong></div>
          <div><span class="metric-label">Engagement type</span><strong>${esc(titleize(campaign.engagement_type))}</strong></div>
          <div><span class="metric-label">Total items</span><strong>${counts.totalItems}</strong></div>
          <div><span class="metric-label">Handoff-ready</span><strong>${counts.moderationQueue.readyForHandoffCount}</strong></div>
        </div>
      </div>
      <div>
        <h3>Moderation and coverage</h3>
        <div class="metrics-grid">
          <div><span class="metric-label">Actionable review</span><strong>${counts.moderationQueue.actionableCount}</strong></div>
          <div><span class="metric-label">Uncategorized</span><strong>${counts.uncategorizedItems}</strong></div>
          <div><span class="metric-label">Geolocated share</span><strong>${Math.round(
            counts.geographyCoverage.geolocatedShare * 100
          )}%</strong></div>
          <div><span class="metric-label">Recent activity</span><strong>${counts.recentActivity.count}</strong></div>
        </div>
        <p>${
          counts.moderationQueue.readyForHandoffCount > 0
            ? esc(
                `${counts.moderationQueue.readyForHandoffCount} approved and categorized items are ready for planning review.`
              )
            : "No items are currently both approved and categorized."
        }</p>
      </div>
    </div>
    ${engagementHandoffMarkup(data)}
    <div class="two-col" style="margin-top: 18px;">
      <div>
        <h3>Top categories</h3>
        ${
          topCategories.length > 0
            ? `<ul class="record-list">${topCategories
                .map(
                  (category) => `<li>
                    <strong>${esc(category.label)}</strong>
                    <p>${category.description ? esc(category.description) : "No description recorded."}</p>
                    <span class="meta">${category.count} items • ${category.flaggedCount} flagged • ${category.pendingCount} pending</span>
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No categorized engagement items are attached yet.</p>`
        }
      </div>
      <div>
        <h3>Source mix</h3>
        ${
          topSources.length > 0
            ? `<ul class="record-list">${topSources
                .map(
                  (source) => `<li>
                    <strong>${esc(titleize(source.sourceType))}</strong>
                    <span class="meta">${source.count} items • ${source.geolocatedCount} geolocated • ${source.flaggedCount} flagged</span>
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="empty">No engagement items are attached yet.</p>`
        }
      </div>
    </div>`;
  }

  return `<p class="empty">No renderer is available for section key ${esc(sectionKey)}.</p>`;
}

export function buildReportHtml(data: ReportGenerationData): string {
  const enabledSections = data.sections
    .filter((section) => section.enabled)
    .sort((left, right) => left.sort_order - right.sort_order);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.report.title)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f0e8; color: #13222b; font-family: Georgia, "Times New Roman", serif; }
      main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 80px; }
      .hero { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 28px; padding: 32px; background: linear-gradient(180deg, #fefcf7, #f5efe3); box-shadow: 0 30px 70px rgba(19, 34, 43, 0.08); }
      .eyebrow { font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #965c2a; }
      h1, h2, h3 { margin: 0; }
      h1 { margin-top: 12px; font-size: 42px; line-height: 1.05; }
      .hero p { max-width: 760px; font-size: 17px; line-height: 1.6; }
      section { margin-top: 24px; border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 24px; padding: 24px; background: rgba(255, 255, 255, 0.8); }
      .section-title { margin-bottom: 16px; font-size: 24px; }
      .two-col { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .facts, .metrics-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
      .facts div, .metrics-grid div, .transparency-item, .metric-card { border: 1px solid rgba(19, 34, 43, 0.1); border-radius: 18px; padding: 14px; background: #fffdf8; }
      dt, .metric-label, .meta { display: block; font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #6d7479; }
      dd, strong { margin: 6px 0 0; font-size: 18px; }
      .record-list, .timeline { margin: 0; padding-left: 20px; display: grid; gap: 12px; }
      .record-list li, .timeline li { padding-left: 4px; }
      .run-card { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 22px; padding: 18px; background: #fffdf8; }
      .run-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; }
      .pill-pass { background: #d8f3df; color: #15653a; }
      .pill-hold { background: #fde2d2; color: #9a3412; }
      .warning-box { border-radius: 18px; padding: 14px 16px; background: #fff3df; border: 1px solid rgba(150, 92, 42, 0.2); }
      .transparency-grid, .metrics-stack { display: grid; gap: 12px; margin-top: 14px; }
      .empty { color: #6d7479; font-style: italic; }
      @media (max-width: 700px) { main { padding: 20px 14px 56px; } h1 { font-size: 34px; } }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <span class="eyebrow">OpenPlan Reports</span>
        <h1>${esc(data.report.title)}</h1>
        <p>${esc(data.report.summary || "Structured report packet with explicit provenance and source transparency.")}</p>
        <div class="facts" style="margin-top: 18px;">
          <div><dt>Project</dt><dd>${esc(data.project.name)}</dd></div>
          <div><dt>Report Type</dt><dd>${esc(formatReportTypeLabel(data.report.report_type))}</dd></div>
          <div><dt>Created</dt><dd>${esc(formatDateTime(data.report.created_at))}</dd></div>
          <div><dt>Linked Runs</dt><dd>${data.runs.length}</dd></div>
        </div>
      </header>
      ${stageGateProvenanceMarkup(data)}
      ${projectRecordsProvenanceMarkup(data)}
      ${scenarioBasisMarkup(data)}
      ${enabledSections
        .map(
          (section) => `<section id="${esc(section.section_key)}">
            <h2 class="section-title">${esc(section.title)}</h2>
            ${sectionMarkup(section.section_key, data)}
          </section>`
        )
        .join("")}
    </main>
  </body>
</html>`;
}
