import { NextRequest, NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";

const CSP_REPORT_MAX_BYTES = 16 * 1024;

type NormalizedReport = {
  blockedUri?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  documentUri?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptSample?: string;
  disposition?: string;
  referrer?: string;
};

function normalizeCspOneReport(body: Record<string, unknown>): NormalizedReport {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    blockedUri: str(body["blocked-uri"]) ?? str(body.blockedURL),
    violatedDirective: str(body["violated-directive"]) ?? str(body.violatedDirective),
    effectiveDirective: str(body["effective-directive"]) ?? str(body.effectiveDirective),
    documentUri: str(body["document-uri"]) ?? str(body.documentURL),
    sourceFile: str(body["source-file"]) ?? str(body.sourceFile),
    lineNumber: num(body["line-number"]) ?? num(body.lineNumber),
    columnNumber: num(body["column-number"]) ?? num(body.columnNumber),
    scriptSample: str(body["script-sample"]) ?? str(body.sample),
    disposition: str(body.disposition),
    referrer: str(body.referrer),
  };
}

function extractReports(parsed: unknown): NormalizedReport[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const body = entry.body;
        if (typeof body === "object" && body !== null) {
          return normalizeCspOneReport(body as Record<string, unknown>);
        }
        return normalizeCspOneReport(entry);
      });
  }
  if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const legacy = obj["csp-report"];
    if (typeof legacy === "object" && legacy !== null) {
      return [normalizeCspOneReport(legacy as Record<string, unknown>)];
    }
    return [normalizeCspOneReport(obj)];
  }
  return [];
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("csp.report", request);

  let parsed: unknown = null;
  const body = await readJsonWithLimit(request, CSP_REPORT_MAX_BYTES);
  if (!body.ok) {
    audit.warn("csp_report_body_too_large", {
      byteLength: body.byteLength,
      maxBytes: CSP_REPORT_MAX_BYTES,
    });
    return body.response;
  }
  parsed = body.data;

  const reports = extractReports(parsed);
  for (const report of reports) {
    audit.warn("csp_violation", report);
  }

  return new NextResponse(null, { status: 204 });
}
