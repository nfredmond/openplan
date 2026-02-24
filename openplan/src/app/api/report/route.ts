import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const reportRequestSchema = z.object({
  runId: z.string().uuid(),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = reportRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("runs")
    .select("id, title, query_text, summary_text, metrics, corridor_geojson, created_at")
    .eq("id", parsed.data.runId)
    .single();

  if (error || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const metrics = (run.metrics as Record<string, number> | null) ?? {};
  const timestamp = run.created_at ? new Date(run.created_at).toLocaleString() : "Unknown";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(run.title ?? "OpenPlan Report")}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #111827; }
      h1, h2 { margin-bottom: 8px; }
      p { margin: 6px 0; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
      th { background: #f3f4f6; }
      .muted { color: #4b5563; }
      .block { margin-top: 20px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(run.title ?? "Untitled Run")}</h1>
    <p class="muted">Generated: ${escapeHtml(new Date().toLocaleString())}</p>
    <p class="muted">Run timestamp: ${escapeHtml(timestamp)}</p>

    <section class="block">
      <h2>Query</h2>
      <p>${escapeHtml(run.query_text ?? "")}</p>
    </section>

    <section class="block">
      <h2>Summary</h2>
      <p>${escapeHtml(run.summary_text ?? "No summary available.")}</p>
    </section>

    <section class="block">
      <h2>Metrics</h2>
      <table>
        <thead>
          <tr><th>Metric</th><th>Value</th></tr>
        </thead>
        <tbody>
          <tr><td>Accessibility Score</td><td>${escapeHtml(String(metrics.accessibilityScore ?? "n/a"))}</td></tr>
          <tr><td>Safety Score</td><td>${escapeHtml(String(metrics.safetyScore ?? "n/a"))}</td></tr>
          <tr><td>Equity Score</td><td>${escapeHtml(String(metrics.equityScore ?? "n/a"))}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>Corridor GeoJSON</h2>
      <pre>${escapeHtml(JSON.stringify(run.corridor_geojson, null, 2))}</pre>
    </section>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
