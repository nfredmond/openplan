import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { createApiAuditLogger } from "@/lib/observability/audit";

const reportRequestSchema = z.object({
  runId: z.string().uuid(),
  format: z.enum(["html", "pdf"]).default("html"),
});

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return n.toLocaleString("en-US");
}

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return "$" + n.toLocaleString("en-US");
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return n + "%";
}

function scoreColor(score: number): string {
  if (score >= 70) return "#059669"; // green
  if (score >= 40) return "#d97706"; // amber
  return "#dc2626"; // red
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

function toAscii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "?");
}

function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return toAscii(String(value).replace(/\s+/g, " ").trim());
}

function wrapText(line: string, max = 95): string[] {
  if (!line || line.length <= max) {
    return [line];
  }

  const words = line.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= max) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let remainder = word;
    while (remainder.length > max) {
      lines.push(remainder.slice(0, max));
      remainder = remainder.slice(max);
    }
    current = remainder;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function pdfEscape(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPdf(run: any): Uint8Array {
  const encoder = new TextEncoder();
  const metrics = (run.metrics ?? {}) as Record<string, unknown>;
  const createdAt = run.created_at ? new Date(run.created_at).toISOString() : "Unknown";
  const title = sanitizeText((run.title as string) ?? "Corridor Analysis Report");
  const queryText = sanitizeText(run.query_text);
  const summaryText = sanitizeText(run.summary_text ?? "No summary available.");
  const interpretation = sanitizeText(
    run.ai_interpretation ?? run.summary_text ?? "No interpretation available."
  );

  const selectedMetrics: Array<[string, unknown]> = [
    ["Overall Score", metrics.overallScore],
    ["Accessibility Score", metrics.accessibilityScore],
    ["Safety Score", metrics.safetyScore],
    ["Equity Score", metrics.equityScore],
    ["Total Population", metrics.totalPopulation],
    ["Transit Stops", metrics.totalTransitStops],
    ["Fatal Crashes", metrics.totalFatalCrashes],
    ["Justice40 Eligible", metrics.justice40Eligible],
    ["AI Interpretation Source", metrics.aiInterpretationSource ?? (metrics.dataQuality as { aiInterpretationSource?: string } | undefined)?.aiInterpretationSource ?? "unknown"],
  ];

  const lines: string[] = [
    "OpenPlan Report",
    `Title: ${title}`,
    `Run ID: ${sanitizeText(run.id)}`,
    `Created At: ${createdAt}`,
    "",
    "Query:",
    queryText || "N/A",
    "",
    "Summary:",
    summaryText,
    "",
    "AI Interpretation:",
    interpretation,
    "",
    "Selected Metrics:",
    ...selectedMetrics.map(([label, value]) => `${label}: ${sanitizeText(value ?? "N/A") || "N/A"}`),
  ];

  const wrappedLines = lines.flatMap((line) => wrapText(line));
  const visibleLines = wrappedLines.slice(0, 48);

  const contentCommands = ["BT", "/F1 12 Tf", "50 760 Td", "14 TL"];
  for (const line of visibleLines) {
    contentCommands.push(`(${pdfEscape(line)}) Tj`);
    contentCommands.push("T*");
  }
  contentCommands.push("ET");

  const contentStream = contentCommands.join("\n");
  const contentLength = encoder.encode(contentStream).length;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream`,
  ];

  const pdfParts: string[] = [];
  let length = 0;
  const offsets = [0];

  const pushPart = (part: string) => {
    pdfParts.push(part);
    length += encoder.encode(part).length;
  };

  pushPart("%PDF-1.4\n%OpenPlan\n");

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(length);
    pushPart(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }

  const xrefStart = length;
  pushPart(`xref\n0 ${objects.length + 1}\n`);
  pushPart("0000000000 65535 f \n");

  for (let index = 1; index < offsets.length; index += 1) {
    pushPart(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }

  pushPart(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`);
  pushPart(`startxref\n${xrefStart}\n%%EOF\n`);

  return encoder.encode(pdfParts.join(""));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHtml(run: any): string {
  const m = (run.metrics ?? {}) as Record<string, unknown>;
  const timestamp = run.created_at ? new Date(run.created_at).toLocaleString() : "Unknown";
  const generatedAt = new Date().toLocaleString();
  const title = (run.title as string) ?? "Corridor Analysis Report";
  const aiInterpretation = (run.ai_interpretation as string | null) ?? null;

  const confidence = (m.confidence as string) ?? "unknown";
  const title6Flags = (m.title6Flags ?? []) as string[];
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
    Generated: ${esc(generatedAt)} · Analysis run: ${esc(timestamp)} · Confidence: ${esc(confidence)} · Narrative mode: ${esc(aiNarrativeStatus)}
  </div>
</div>

<!-- SCORES -->
<h2>Corridor Scores</h2>
<div class="scores-grid">
  <div class="score-card">
    <div class="value" style="color:${scoreColor(Number(m.accessibilityScore) || 0)}">
      ${fmt(m.accessibilityScore as number)}
    </div>
    <div class="label">Accessibility</div>
  </div>
  <div class="score-card">
    <div class="value" style="color:${scoreColor(Number(m.safetyScore) || 0)}">
      ${fmt(m.safetyScore as number)}
    </div>
    <div class="label">Safety</div>
  </div>
  <div class="score-card">
    <div class="value" style="color:${scoreColor(Number(m.equityScore) || 0)}">
      ${fmt(m.equityScore as number)}
    </div>
    <div class="label">Equity</div>
  </div>
</div>
${scoreBar(Number(m.overallScore) || 0, "Overall Composite Score")}

<!-- ANALYSIS SUMMARY -->
<h2>Analysis Summary</h2>
<div class="summary-box">${esc(run.summary_text ?? "No summary available.")}</div>

<!-- AI INTERPRETATION -->
<h2>AI Interpretation (Grant Narrative)</h2>
<div class="summary-box">${esc(aiInterpretation ?? run.summary_text ?? "No interpretation available.")}</div>

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
  <tr><td>Total Transit Stops / Stations</td><td>${fmt(m.totalTransitStops as number)}</td></tr>
  <tr><td>Bus Stops</td><td>${fmt(m.busStops as number)}</td></tr>
  <tr><td>Rail Stations</td><td>${fmt(m.railStations as number)}</td></tr>
  <tr><td>Ferry Terminals</td><td>${fmt(m.ferryStops as number)}</td></tr>
  <tr><td>Stops per Square Mile</td><td>${m.stopsPerSquareMile ?? "N/A"}</td></tr>
  <tr><td>Transit Access Tier</td><td>${esc(String(m.transitAccessTier ?? "N/A"))}</td></tr>
  <tr><td>Walk/Bike Access Tier</td><td>${esc(String(m.walkBikeAccessTier ?? "N/A"))}</td></tr>
  <tr><td>Walk/Bike Access Rationale</td><td>${esc(String(m.walkBikeAccessRationale ?? "N/A"))}</td></tr>
</table>

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
  <tr><td>Disadvantaged Tracts (CEJST-aligned)</td><td>${fmt(m.disadvantagedTracts as number)} of ${fmt(m.tractCount as number)} (${pct(m.pctDisadvantaged as number)})</td></tr>
  <tr><td>Low-Income Tracts</td><td>${fmt(m.lowIncomeTracts as number)}</td></tr>
  <tr><td>High-Poverty Tracts (&ge;30%)</td><td>${fmt(m.highPovertyTracts as number)}</td></tr>
  <tr><td>High-Minority Tracts (&ge;50%)</td><td>${fmt(m.highMinorityTracts as number)}</td></tr>
  <tr><td>Low Vehicle Access Tracts (&ge;10% zero-vehicle households)</td><td>${fmt(m.lowVehicleAccessTracts as number)}</td></tr>
  <tr><td>Transit Dependency Tracts (&ge;15% transit commute share)</td><td>${fmt(m.highTransitDependencyTracts as number)}</td></tr>
  <tr><td>Burdened Low-Income Tracts</td><td>${fmt(m.burdenedLowIncomeTracts as number)}</td></tr>
  <tr><td>Screening Method</td><td>${esc(String(m.equitySource ?? "cejst-proxy-census"))}</td></tr>
  <tr><td>Justice40 Eligible</td><td>${(m.justice40Eligible as boolean) ? "✅ Yes" : "No"}</td></tr>
</table>

${title6Flags.length > 0 ? `
<h3>Title VI / Environmental Justice Considerations</h3>
${title6Flags.map((f: string) => `<div class="flag">${esc(f)}</div>`).join("\n")}
` : ""}

${(m.justice40Eligible as boolean) ? `
<div class="flag green">
  This corridor includes disadvantaged communities per the Justice40 Initiative,
  which may qualify projects for priority consideration under federal programs
  including RAISE, SS4A, and Reconnecting Communities.
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

<!-- QUERY -->
<h2>Analysis Query</h2>
<p>${esc(run.query_text ?? "")}</p>

<div class="footer">
  Generated by OpenPlan — AI-Powered Transportation Planning Intelligence<br/>
  Nat Ford Planning &amp; Analysis · natfordplanning.com
</div>

</body>
</html>`;
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("report", request);
  const startedAt = Date.now();
  let runId: string | undefined;
  let format: "html" | "pdf" = "html";

  try {
    const body = await request.json().catch(() => null);
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

    const supabase = await createClient();
    const { data: run, error } = await supabase
      .from("runs")
      .select(
        "id, title, query_text, summary_text, ai_interpretation, metrics, corridor_geojson, created_at, report_generated_count, first_report_generated_at, last_report_generated_at"
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

    const reportGeneratedAt = new Date().toISOString();
    const currentReportCount = typeof run.report_generated_count === "number" ? run.report_generated_count : 0;

    const serviceSupabase = createServiceRoleClient();
    const { error: telemetryError } = await serviceSupabase
      .from("runs")
      .update({
        report_generated_count: currentReportCount + 1,
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

    const durationMs = Date.now() - startedAt;
    audit.info("report_generated", {
      runId,
      format,
      durationMs,
      reportGeneratedCount: currentReportCount + 1,
    });

    if (format === "pdf") {
      const pdfBytes = buildPdf(run);
      const pdfBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      ) as ArrayBuffer;

      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="openplan-report-${run.id}.pdf"`,
        },
      });
    }

    return new NextResponse(buildHtml(run), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    audit.error("report_unhandled_error", {
      runId,
      format,
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json(
      { error: "Report generation failed unexpectedly" },
      { status: 500 }
    );
  }
}
