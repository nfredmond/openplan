import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { resolveDecisionUseDisclosure } from "@/lib/analysis/decision-use";
import { resolveTransitMethod, transitMethodLine } from "@/lib/data-sources/transit/method";
import { resolveCensusScoreInputCoverage } from "@/lib/analysis/census-score-inputs";
import { renderReportPdf } from "@/lib/reports/pdf";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import {
  federalJustice40ShortStatus,
  PROGRAM_DISCONTINUED_CAVEAT,
} from "@/lib/data-sources/equity-designation/disclosure";
import type { Justice40Determination, Justice40Status } from "@/lib/data-sources/equity-designation/types";

const REPORT_REQUEST_MAX_BODY_BYTES = BODY_LIMITS.documentJson;

/**
 * Rebuild the federal Justice40 determination from the flat metric scalars an
 * analysis run persisted. Returns null for LEGACY runs (persisted before this
 * feature, which only carried a `justice40Eligible` boolean) so the report
 * renders a proxy-only note rather than resurrecting the old fabricated federal
 * claim from an income proxy.
 */
function reconstructFederalJustice40(m: Record<string, unknown>): Justice40Determination | null {
  const status = m.federalJustice40Status;
  if (status !== "disadvantaged" && status !== "not_disadvantaged" && status !== "not_determined") {
    return null;
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cause = m.federalJustice40NotDeterminedCause;
  return {
    status: status as Justice40Status,
    source: typeof m.federalJustice40Source === "string" ? m.federalJustice40Source : null,
    datasetLabel: typeof m.federalJustice40DatasetLabel === "string" ? m.federalJustice40DatasetLabel : null,
    version: null,
    vintage: null,
    notDeterminedCause:
      cause === "out_of_coverage" || cause === "source_unavailable" || cause === "no_matching_record"
        ? cause
        : status === "not_determined"
          ? "no_matching_record"
          : null,
    coverage: {
      totalTracts: num(m.tractCount),
      determinedTracts: num(m.federalJustice40DeterminedTracts),
      undeterminedTracts: num(m.federalJustice40UndeterminedTracts),
      disadvantagedTracts: num(m.federalJustice40DisadvantagedTracts),
      crosswalkInferredTracts: num(m.federalJustice40CrosswalkInferredTracts),
    },
  };
}

const mapViewStateSchema = z.object({
  tractMetric: z.enum(["minority", "poverty", "income", "disadvantaged"]).optional(),
  showTracts: z.boolean().optional(),
  showCrashes: z.boolean().optional(),
  crashSeverityFilter: z.enum(["all", "fatal", "severe_injury", "injury"]).optional(),
  crashUserFilter: z.enum(["all", "pedestrian", "bicycle", "vru"]).optional(),
  activeDatasetOverlayId: z.string().uuid().nullable().optional(),
  activeOverlayContext: z
    .object({
      datasetId: z.string().uuid(),
      datasetName: z.string().min(1).max(160),
      overlayMode: z.enum(["coverage_footprint", "thematic_overlay"]),
      geometryAttachment: z.string().max(80).nullable().optional(),
      thematicMetricKey: z.string().max(80).nullable().optional(),
      thematicMetricLabel: z.string().max(120).nullable().optional(),
      connectorLabel: z.string().max(160).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const reportRequestSchema = z.object({
  runId: z.string().uuid(),
  format: z.enum(["html", "pdf"]).default("html"),
  template: z.enum(["atp", "ss4a"]).default("atp"),
  mapViewState: mapViewStateSchema.optional(),
});

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * "Not measured", not "N/A".
 *
 * Every null in a run's metrics got here the same way: a source did not answer,
 * or an ACS universe was empty. "N/A" reads as *not applicable to this corridor*,
 * which is a claim about the place. "Not measured" is a claim about the read, and
 * it is the true one. In a grant-ready PDF the difference is the whole point:
 * a reviewer must be able to tell a corridor with no transit riders from a
 * corridor nobody counted.
 */
const NOT_MEASURED = "Not measured";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return NOT_MEASURED;
  return n.toLocaleString("en-US");
}

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return NOT_MEASURED;
  return "$" + n.toLocaleString("en-US");
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return NOT_MEASURED;
  return n + "%";
}

function scoreColor(score: number): string {
  if (score >= 70) return "#059669"; // green
  if (score >= 40) return "#d97706"; // amber
  return "#dc2626"; // red
}

/**
 * A headline score card, or an honest blank.
 *
 * The defect this closes: each card read `scoreColor(Number(m.safetyScore) || 0)`
 * with `fmt(m.safetyScore)` inside it. `safetyScore` is null whenever no crash
 * source answered — the ordinary case outside a registered adapter's coverage —
 * so the card rendered "N/A" in the RED reserved for a score below 40. A corridor
 * nobody could measure looked, in a grant-ready PDF, like the most dangerous
 * corridor on the page.
 */
function scoreCard(
  value: unknown,
  label: string,
  missingNote: string,
  /**
   * Attached when the score EXISTS but was built on demographic inputs that were
   * never read. A grant reviewer holding this PDF has no other way to tell an
   * "Equity 0" that was measured from one that was computed over zero tracts.
   */
  computedNote: string | null = null
): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (numeric === null) {
    return `
  <div class="score-card">
    <div class="value" style="color:#6b7280;font-size:20px;">Not measured</div>
    <div class="label">${esc(label)}</div>
    <div class="muted" style="margin-top:6px;">${esc(missingNote)}</div>
  </div>`;
  }
  return `
  <div class="score-card">
    <div class="value" style="color:${scoreColor(numeric)}">${fmt(numeric)}</div>
    <div class="label">${esc(label)}</div>${
      computedNote ? `\n    <div class="muted" style="margin-top:6px;">${esc(computedNote)}</div>` : ""
    }
  </div>`;
}

function scoreBar(score: number, label: string): string {
  const color = scoreColor(score);
  return `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-weight:600;">${esc(label)}</span>
        <span style="font-weight:700;color:${color};">${score}/100</span>
      </div>
      <div style="background:#e5e7eb;border-radius:6px;height:12px;overflow:hidden;">
        <div style="width:${score}%;background:${color};height:100%;border-radius:6px;"></div>
      </div>
    </div>`;
}

function getTemplateMeta(template: "atp" | "ss4a") {
  if (template === "ss4a") {
    return {
      label: "SS4A",
      subtitle: "Safe Streets and Roads for All framing",
      emphasis: "Crash reduction, safe system countermeasures, and equitable safety outcomes.",
    };
  }

  return {
    label: "ATP",
    subtitle: "Active Transportation Program framing",
    emphasis: "Mode shift, active access, and disadvantaged community benefit alignment.",
  };
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatCrashUserFilterLabel(value: string | undefined): string {
  if (value === "vru") return "Ped or bike";
  if (value === "pedestrian") return "Ped only";
  if (value === "bicycle") return "Bike only";
  return "All users";
}

function formatGeometryAttachmentLabel(value: string | null | undefined): string {
  if (value === "analysis_tracts") return "Analysis tracts";
  if (value === "analysis_corridor") return "Analysis corridor";
  if (value === "analysis_crash_points") return "Analysis crash points";
  if (!value || value === "none") return "None";
  return titleize(value);
}

function formatOverlayModeLabel(value: string | null | undefined): string {
  if (value === "thematic_overlay") return "Thematic overlay";
  if (value === "coverage_footprint") return "Coverage footprint";
  return "Unknown";
}

function buildMapViewSummary(
  mapViewState: Record<string, unknown> | null | undefined
): string[] {
  if (!mapViewState) {
    return [];
  }

  const overlayContext =
    mapViewState.activeOverlayContext &&
    typeof mapViewState.activeOverlayContext === "object" &&
    !Array.isArray(mapViewState.activeOverlayContext)
      ? (mapViewState.activeOverlayContext as Record<string, unknown>)
      : null;

  const overlayValue =
    typeof overlayContext?.datasetName === "string"
      ? overlayContext.overlayMode === "thematic_overlay"
        ? `${overlayContext.datasetName} · ${typeof overlayContext.thematicMetricLabel === "string" && overlayContext.thematicMetricLabel.length > 0 ? overlayContext.thematicMetricLabel : titleize(typeof overlayContext.thematicMetricKey === "string" ? overlayContext.thematicMetricKey : undefined)}`
        : overlayContext.datasetName
      : typeof mapViewState.activeDatasetOverlayId === "string"
        ? "Selected"
        : "None";

  const rows = [
    `Tract theme: ${titleize(typeof mapViewState.tractMetric === "string" ? mapViewState.tractMetric : "unknown")}`,
    `Census tracts: ${mapViewState.showTracts === false ? "Hidden" : "Visible"}`,
    `Crash layer: ${mapViewState.showCrashes === false ? "Hidden" : "Visible when available"}`,
    `Crash severity filter: ${titleize(typeof mapViewState.crashSeverityFilter === "string" ? mapViewState.crashSeverityFilter : "all")}`,
    `Crash user filter: ${formatCrashUserFilterLabel(typeof mapViewState.crashUserFilter === "string" ? mapViewState.crashUserFilter : "all")}`,
    `Project overlay: ${overlayValue}`,
  ];

  if (overlayContext) {
    rows.push(`Overlay mode: ${formatOverlayModeLabel(typeof overlayContext.overlayMode === "string" ? overlayContext.overlayMode : undefined)}`);
    rows.push(`Overlay geometry: ${formatGeometryAttachmentLabel(typeof overlayContext.geometryAttachment === "string" ? overlayContext.geometryAttachment : null)}`);
  }

  return rows;
}

function buildHtml(
  run: Record<string, unknown>,
  template: "atp" | "ss4a",
  mapViewState?: Record<string, unknown> | null
): string {
  const m = (run.metrics ?? {}) as Record<string, unknown>;
  const templateMeta = getTemplateMeta(template);
  const createdAtValue = typeof run.created_at === "string" ? run.created_at : null;
  const timestamp = createdAtValue ? new Date(createdAtValue).toLocaleString() : "Unknown";
  const generatedAt = new Date().toLocaleString();
  const title = typeof run.title === "string" ? run.title : "Corridor Analysis Report";
  const queryText = typeof run.query_text === "string" ? run.query_text : "";
  const aiInterpretation =
    typeof run.ai_interpretation === "string" ? stripFactCitationTokens(run.ai_interpretation) : null;
  const summaryText = typeof run.summary_text === "string" ? run.summary_text : "No summary available.";
  const mapViewSummary = buildMapViewSummary(mapViewState);

  const confidence = (m.confidence as string) ?? "unknown";
  // Every run has recorded this since the traceability block existed; no report
  // ever printed it. A grant-ready PDF that does not state how far its own
  // numbers may be carried is the artifact most likely to be over-read.
  const decisionUse = resolveDecisionUseDisclosure(m);
  /**
   * HOW THIS RUN MEASURED TRANSIT, PRINTED BESIDE THE FIGURES IT PRODUCED.
   *
   * Read off the run, never re-derived from today's registry: this PDF is
   * generated long after the run and often for a different reader, and a run
   * stored before a source existed must keep describing itself the way it did
   * when it was stored.
   *
   * The reason a report needs it at all is that the same corridor can now
   * produce two stop counts on two different scales — a count of mapped
   * OpenStreetMap objects, or the stops an agency's own published schedule calls
   * at. Two PDFs of the same corridor, months apart, can therefore disagree, and
   * this line is the only thing in the artifact that explains why. A grant
   * reviewer reads the number, not the software.
   */
  const transitMethod = resolveTransitMethod(m);
  /**
   * The frequent-service share WITH ITS DENOMINATOR NAMED.
   *
   * The percentage alone is what a grant reviewer quotes, and a percentage whose
   * denominator is not on the page is a number nobody can check. It is taken over
   * every stop counted in the row above — a stop with no derivable peak headway
   * on a representative service day counts as not meeting the threshold — and
   * saying so is the difference between a share of the corridor and a share of a
   * subset the reader never sees.
   */
  const transitFrequentShare =
    typeof m.frequentServiceShare === "number"
      ? `${Math.round(m.frequentServiceShare * 1000) / 10}%` +
        (typeof m.totalTransitStops === "number"
          ? ` of all ${m.totalTransitStops.toLocaleString()} stops counted`
          : "")
      : "Not measured";
  /**
   * The qualifications a GTFS-derived figure may not be printed without.
   *
   * They travel from the run's own snapshot rather than being rebuilt here: a
   * caveat that exists in two places drifts into two different promises, and the
   * weaker one is what somebody eventually cites.
   */
  const transitCaveats = (() => {
    const snapshot = (m.sourceSnapshots as Record<string, unknown> | undefined)?.transit as
      | { caveats?: unknown }
      | undefined;
    return Array.isArray(snapshot?.caveats)
      ? snapshot.caveats.filter((entry): entry is string => typeof entry === "string")
      : [];
  })();
  // Whether the ACS read behind the Accessibility and Equity scores answered at
  // all. When it did not, both scores were computed over placeholder zeros and
  // are deflated; the PDF is the artifact most likely to be read by someone who
  // cannot ask, so the caveat rides on the cards themselves.
  const censusScoreInputs = resolveCensusScoreInputCoverage(m);
  const title6Flags = (m.title6Flags ?? []) as string[];
  // Real federal Justice40 determination for this run, or null for a legacy run.
  const federalJ40 = reconstructFederalJustice40(m);
  const sourceTransparency = buildSourceTransparency(
    m,
    (m.aiInterpretationSource as string | undefined) ?? undefined
  );
  const aiNarrativeStatus = sourceTransparency.find((item) => item.key === "ai")?.status ?? "Unknown";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)} — OpenPlan Report</title>
  <style>
    @page { size: letter; margin: 0.75in; }
    body {
      font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
      margin: 0; padding: 32px 40px; color: #1f2937;
      font-size: 14px; line-height: 1.6;
    }
    .header { border-bottom: 3px solid #1d4ed8; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 24px; color: #1d4ed8; margin: 0 0 4px; }
    .header .subtitle { color: #6b7280; font-size: 13px; }
    .header .logo { float: right; font-weight: 800; font-size: 18px; color: #1d4ed8; }
    h2 { font-size: 16px; color: #1d4ed8; margin: 28px 0 12px; border-bottom: 1px solid #dbeafe; padding-bottom: 6px; }
    h3 { font-size: 14px; color: #374151; margin: 16px 0 8px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 13px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; }
    th { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
    td { background: #fff; }
    .scores-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin: 12px 0 20px; }
    .score-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
    .score-card .value { font-size: 32px; font-weight: 700; }
    .score-card .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
    .flag { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 12px; margin: 4px 0; font-size: 13px; }
    .flag.green { background: #d1fae5; border-left-color: #059669; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; white-space: pre-wrap; font-size: 13px; line-height: 1.7; }
    .muted { color: #6b7280; font-size: 12px; }
    .footer { border-top: 1px solid #e5e7eb; margin-top: 32px; padding-top: 12px; font-size: 11px; color: #9ca3af; text-align: center; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media print {
      body { padding: 0; }
      .scores-grid { break-inside: avoid; }
    }
  </style>
</head>
<body>

<div class="header">
  <div class="logo">OpenPlan</div>
  <h1>${esc(title)}</h1>
  <div class="subtitle">
    Generated: ${esc(generatedAt)} · Analysis run: ${esc(timestamp)} · Program lens: ${esc(templateMeta.label)} · Confidence: ${esc(confidence)} · Narrative mode: ${esc(aiNarrativeStatus)}
  </div>
</div>

<!-- DECISION USE -->
<div class="flag">
  <strong>${esc(decisionUse.label)}</strong><br/>
  ${esc(decisionUse.detail)}
</div>

<!-- SCORES -->
<h2>Corridor Scores</h2>
<div class="scores-grid">
  ${scoreCard(m.accessibilityScore, "Accessibility", "No accessibility score was recorded for this run.", censusScoreInputs.caveat)}
  ${scoreCard(m.safetyScore, "Safety", "No crash source covered this study area, so no safety score was produced. An unmeasured corridor is not a safe one.")}
  ${scoreCard(m.equityScore, "Equity", "No equity screening score was recorded for this run.", censusScoreInputs.caveat)}
</div>
${scoreBar(Number(m.overallScore) || 0, "Overall Composite Score")}

<h2>Funding Program Lens</h2>
<div class="summary-box">
  <strong>${esc(templateMeta.label)} framing:</strong> ${esc(templateMeta.subtitle)}
  <br/><br/>
  ${esc(templateMeta.emphasis)}
</div>

<!-- ANALYSIS SUMMARY -->
<h2>Analysis Summary</h2>
<div class="summary-box">${esc(summaryText)}</div>

<!-- AI INTERPRETATION -->
<h2>AI Interpretation (${esc(templateMeta.label)} Narrative)</h2>
<div class="summary-box">${esc(aiInterpretation ?? summaryText ?? "No interpretation available.")}</div>

<!-- DEMOGRAPHICS -->
<h2>Demographics &amp; Commute Patterns</h2>
<div class="two-col">
  <div>
    <h3>Population &amp; Income</h3>
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Population</td><td>${fmt(m.totalPopulation as number)}</td></tr>
      <tr><td>Census Tracts</td><td>${fmt(m.tractCount as number)}</td></tr>
      <tr><td>Median Household Income</td><td>${fmtCurrency(m.medianIncome as number)}</td></tr>
      <tr><td>Minority Population</td><td>${pct(m.pctMinority as number)}</td></tr>
      <tr><td>Below Poverty Level</td><td>${pct(m.pctBelowPoverty as number)}</td></tr>
    </table>
  </div>
  <div>
    <h3>Commute Mode Share</h3>
    <table>
      <tr><th>Mode</th><th>Share</th></tr>
      <tr><td>Public Transit</td><td>${pct(m.pctTransit as number)}</td></tr>
      <tr><td>Walk</td><td>${pct(m.pctWalk as number)}</td></tr>
      <tr><td>Bicycle</td><td>${pct(m.pctBike as number)}</td></tr>
      <tr><td>Work from Home</td><td>${pct(m.pctWfh as number)}</td></tr>
      <tr><td>Zero-Vehicle Households</td><td>${pct(m.pctZeroVehicle as number)}</td></tr>
    </table>
  </div>
</div>

<!-- EMPLOYMENT -->
<h2>Employment</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total Jobs in Corridor</td><td>${fmt(m.totalJobs as number)}</td></tr>
  <tr><td>Jobs per Resident</td><td>${m.jobsPerResident ?? "N/A"}</td></tr>
</table>

<!-- TRANSIT ACCESS -->
<h2>Transit Access</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Measurement method</td><td>${esc(transitMethod.label)}</td></tr>
  <tr><td>Total Transit Stops / Stations</td><td>${fmt(m.totalTransitStops as number)}</td></tr>
  <tr><td>Bus Stops</td><td>${fmt(m.busStops as number)}</td></tr>
  <tr><td>Rail Stations</td><td>${fmt(m.railStations as number)}</td></tr>
  <tr><td>Ferry Terminals</td><td>${fmt(m.ferryStops as number)}</td></tr>
  <tr><td>Stops per Square Mile</td><td>${m.stopsPerSquareMile ?? "N/A"}</td></tr>
  <tr><td>Stops at a ${fmt(m.frequentServiceHeadwayMinutes as number)}-Minute Peak Headway</td><td>${transitFrequentShare}</td></tr>
  <tr><td>Transit Access Tier</td><td>${esc(String(m.transitAccessTier ?? "N/A"))}</td></tr>
  <tr><td>Walk/Bike Access Tier</td><td>${esc(String(m.walkBikeAccessTier ?? "N/A"))}</td></tr>
  <tr><td>Walk/Bike Access Rationale</td><td>${esc(String(m.walkBikeAccessRationale ?? "N/A"))}</td></tr>
</table>
<p class="note"><strong>How transit was measured:</strong> ${esc(transitMethodLine(transitMethod))}</p>
${transitCaveats
  .map((caveat) => `<p class="note">${esc(caveat)}</p>`)
  .join("\n")}

<!-- SAFETY -->
<h2>Safety Analysis</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total Fatal Crashes</td><td>${fmt(m.totalFatalCrashes as number)}</td></tr>
  <tr><td>Total Fatalities</td><td>${fmt(m.totalFatalities as number)}</td></tr>
  <tr><td>Pedestrian Fatalities</td><td>${fmt(m.pedestrianFatalities as number)}</td></tr>
  <tr><td>Bicyclist Fatalities</td><td>${fmt(m.bicyclistFatalities as number)}</td></tr>
  <tr><td>Severe Injury Crashes</td><td>${fmt(m.severeInjuryCrashes as number)}</td></tr>
  <tr><td>Total Injury Crashes</td><td>${fmt(m.totalInjuryCrashes as number)}</td></tr>
  <tr><td>Crashes per Sq Mi (annualized)</td><td>${m.crashesPerSquareMile ?? "N/A"}</td></tr>
</table>

<!-- EQUITY -->
<h2>Equity &amp; Environmental Justice</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Disadvantaged Tracts (proxy screening — not CEJST)</td><td>${fmt(m.disadvantagedTracts as number)} of ${fmt(m.tractCount as number)} (${pct(m.pctDisadvantaged as number)})</td></tr>
  <tr><td>Low-Income Tracts</td><td>${fmt(m.lowIncomeTracts as number)}</td></tr>
  <tr><td>High-Poverty Tracts (&ge;30%)</td><td>${fmt(m.highPovertyTracts as number)}</td></tr>
  <tr><td>High-Minority Tracts (&ge;50%)</td><td>${fmt(m.highMinorityTracts as number)}</td></tr>
  <tr><td>Low Vehicle Access Tracts (&ge;10% zero-vehicle households)</td><td>${fmt(m.lowVehicleAccessTracts as number)}</td></tr>
  <tr><td>Transit Dependency Tracts (&ge;15% transit commute share)</td><td>${fmt(m.highTransitDependencyTracts as number)}</td></tr>
  <tr><td>Burdened Low-Income Tracts</td><td>${fmt(m.burdenedLowIncomeTracts as number)}</td></tr>
  <tr><td>Proxy screening method</td><td>${esc(String(m.equitySource ?? "proxy-census"))} (ACS income + burden — not a federal designation)</td></tr>
  <tr><td>Federal Justice40 / CEJST determination</td><td>${
    federalJ40
      ? esc(federalJustice40ShortStatus(federalJ40))
      : "Not recorded (legacy run — equity shown is an ACS proxy, not CEJST)"
  }</td></tr>
</table>

${title6Flags.length > 0 ? `
<h3>Title VI / Environmental Justice Considerations</h3>
${title6Flags.map((f: string) => `<div class="flag">${esc(f)}</div>`).join("\n")}
` : ""}

${federalJ40?.status === "disadvantaged" ? `
<div class="flag green">
  This corridor includes tract(s) designated disadvantaged in the Climate and
  Economic Justice Screening Tool (${esc(federalJ40.datasetLabel ?? "CEJST v1.0")}).
  <strong>Important:</strong> ${esc(PROGRAM_DISCONTINUED_CAVEAT)}
  Verify any program eligibility (e.g. RAISE, SS4A, Reconnecting Communities)
  against current agency guidance.
</div>
` : ""}

<!-- DATA QUALITY -->
<h2>Data Sources &amp; Quality</h2>
<table>
  <tr><th>Source</th><th>Status</th><th>Transparency Note</th></tr>
  ${sourceTransparency
    .map(
      (item) => `<tr><td>${esc(item.label)}</td><td>${esc(item.status)}</td><td>${esc(item.detail)}</td></tr>`
    )
    .join("\n")}
</table>
<p class="muted">Analysis confidence: ${esc(confidence)}. Source transparency values are generated from run metadata and carried into both the UI and exported report.</p>

${mapViewSummary.length > 0 ? `
<h2>Active Map View</h2>
<table>
  <tr><th>View setting</th><th>Value</th></tr>
  ${mapViewSummary
    .map((line) => {
      const [label, ...rest] = line.split(": ");
      return `<tr><td>${esc(label)}</td><td>${esc(rest.join(": ") || "N/A")}</td></tr>`;
    })
    .join("\n")}
</table>
` : ""}

<!-- QUERY -->
<h2>Analysis Query</h2>
<p>${esc(queryText)}</p>

<div class="footer">
  Generated by OpenPlan — free, open-source planning software
</div>

</body>
</html>`;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("report", request);
  const startedAt = Date.now();
  let runId: string | undefined;
  let format: "html" | "pdf" = "html";
  let template: "atp" | "ss4a" = "atp";
  let requestedMapViewState: Record<string, unknown> | null = null;

  try {
    const bodyRead = await readJsonWithLimit(request, REPORT_REQUEST_MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      audit.warn("request_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes: REPORT_REQUEST_MAX_BODY_BYTES,
      });
      return bodyRead.response;
    }

    const body = bodyRead.data;
    const parsed = reportRequestSchema.safeParse(body);

    if (!parsed.success) {
      const requestedFormat =
        body && typeof body === "object" && "format" in body
          ? (body as { format?: unknown }).format
          : undefined;

      audit.warn("validation_failed", {
        issues: parsed.error.issues.length,
        requestedFormat,
      });
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    runId = parsed.data.runId;
    format = parsed.data.format;
    template = parsed.data.template;
    requestedMapViewState = (parsed.data.mapViewState as Record<string, unknown> | undefined) ?? null;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", {
        runId,
        format,
        template,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: run, error } = await supabase
      .from("runs")
      .select(
        "id, workspace_id, title, query_text, summary_text, ai_interpretation, metrics, corridor_geojson, created_at, report_generated_count, first_report_generated_at, last_report_generated_at"
      )
      .eq("id", runId)
      .single();

    if (error || !run) {
      audit.warn("run_not_found", {
        runId,
        format,
        message: error?.message ?? null,
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", run.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        runId,
        workspaceId: run.workspace_id,
        userId: user.id,
        format,
        template,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership) {
      audit.warn("forbidden_workspace", {
        runId,
        workspaceId: run.workspace_id,
        userId: user.id,
        format,
        template,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("report.generate", membership.role)) {
      audit.warn("forbidden_role", {
        runId,
        workspaceId: run.workspace_id,
        userId: user.id,
        role: membership.role ?? null,
        format,
        template,
      });
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const runMetrics =
      run.metrics && typeof run.metrics === "object" && !Array.isArray(run.metrics)
        ? (run.metrics as Record<string, unknown>)
        : {};
    const resolvedMapViewState =
      requestedMapViewState ??
      (runMetrics.mapViewState && typeof runMetrics.mapViewState === "object" && !Array.isArray(runMetrics.mapViewState)
        ? (runMetrics.mapViewState as Record<string, unknown>)
        : null);

    /**
     * The export precondition: does this run carry the artifacts a report needs?
     *
     * IT IS NOT A STAGE-GATE DECISION, AND IT USED TO BE RECORDED AS ONE. Every
     * export inserted a `stage_gate_decisions` row with
     * `gate_id: "report_artifact_gate"` — a string in NO registered template's
     * gate order — and four things followed from that, all bad:
     *
     *   1. It attributed a machine's arithmetic to a person. `decided_by` was
     *      whoever clicked Export; `evaluateReportArtifactGate` is a pure
     *      function of the run row and exercises no judgement at all. A
     *      stage-gate decision is a judgement someone is accountable for.
     *   2. It stored a DERIVED fact that goes stale. A HOLD recorded at 10:00
     *      is false at 10:05 once the crash snapshot lands, and nothing rewrote
     *      it — so the log accumulated verdicts that used to be true.
     *   3. Nothing read it. Every reader passes rows through
     *      `buildProjectStageGateSummary`, which matches gate ids against the
     *      bound template; these matched nothing and were dropped. They were
     *      write-only rows that then CROWDED OUT real decisions, because each
     *      reader takes the newest 200 — so a workspace that exported reports
     *      pushed its genuine gate decisions out of the window and every gate
     *      silently reverted to "no decision recorded".
     *   4. A failed insert 500'd the export. A report a planner was entitled to
     *      was blocked by a row nobody read.
     *
     * Removing it loses nothing recoverable: the audit line below records the
     * same fields, the 409 hands the caller the decision and the missing
     * artifacts, and the verdict itself is recomputable from the run at any time.
     * The decision log is now what its name says — recorded human judgements
     * against a template's gates, written by /api/stage-gates/decisions.
     */
    const gateResult = evaluateReportArtifactGate(run);
    audit.info("report_gate_decision", {
      runId,
      workspaceId: run.workspace_id,
      userId: user.id,
      format,
      template,
      decision: gateResult.decision,
      missingArtifacts: gateResult.missingArtifacts,
      mapViewState: resolvedMapViewState,
    });

    if (gateResult.decision === "HOLD") {
      return NextResponse.json(
        {
          error: "Required report artifacts missing",
          decision: gateResult.decision,
          missingArtifacts: gateResult.missingArtifacts,
        },
        { status: 409 }
      );
    }

    const reportGeneratedAt = new Date().toISOString();
    const currentReportCount = typeof run.report_generated_count === "number" ? run.report_generated_count : 0;
    const nextReportCount = currentReportCount + 1;

    try {
      const serviceSupabase = createServiceRoleClient();
      const { error: telemetryError } = await serviceSupabase
        .from("runs")
        .update({
          report_generated_count: nextReportCount,
          first_report_generated_at: run.first_report_generated_at ?? reportGeneratedAt,
          last_report_generated_at: reportGeneratedAt,
        })
        .eq("id", run.id);

      if (telemetryError) {
        audit.warn("report_telemetry_update_failed", {
          runId,
          format,
          message: telemetryError.message,
          code: telemetryError.code ?? null,
        });
      }
    } catch (telemetryClientError) {
      audit.warn("report_telemetry_client_failed", {
        runId,
        format,
        error: telemetryClientError,
      });
    }

    const durationMs = Date.now() - startedAt;
    audit.info("report_generated", {
      runId,
      workspaceId: run.workspace_id,
      userId: user.id,
      format,
      template,
      durationMs,
      reportGeneratedCount: nextReportCount,
    });

    if (format === "pdf") {
      // The PDF is now the SAME document as the HTML export, rendered. The
      // replaced builder emitted a separate, thinner text document — ~9
      // labelled values against the HTML's 13 sections — and then cut it to 48
      // lines on a single `/Count 1` page, so a corridor report left the
      // building clipped with nothing saying so.
      const rendered = await renderReportPdf(
        buildHtml(run, template, resolvedMapViewState),
        {
          title: typeof run.title === "string" && run.title.trim() ? run.title.trim() : "Corridor Analysis Report",
          generatedAt: typeof run.created_at === "string" ? run.created_at : null,
          footerLabel: "OpenPlan corridor report",
        }
      );

      if (rendered.engine === "builtin") {
        audit.warn("report_pdf_builtin_typesetter_used", { runId, pageCount: rendered.pageCount });
      }

      const pdfBuffer = rendered.bytes.buffer.slice(
        rendered.bytes.byteOffset,
        rendered.bytes.byteOffset + rendered.bytes.byteLength
      ) as ArrayBuffer;

      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="openplan-report-${run.id}.pdf"`,
          // So a caller can tell the viewer which tier produced the file
          // without opening it.
          "x-openplan-pdf-engine": rendered.engine,
        },
      });
    }

    return new NextResponse(buildHtml(run, template, resolvedMapViewState), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    audit.error("report_unhandled_error", {
      runId,
      format,
      template,
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Report generation failed unexpectedly" },
      { status: 500 }
    );
  }
}
