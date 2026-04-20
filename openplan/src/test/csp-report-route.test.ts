import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createApiAuditLoggerMock = vi.fn();
const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postCspReport } from "@/app/api/csp-report/route";

function request(body: string | null, contentType = "application/csp-report") {
  return new NextRequest("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
  });

  it("accepts legacy CSP1 payload and logs one normalized violation", async () => {
    const body = JSON.stringify({
      "csp-report": {
        "violated-directive": "img-src",
        "blocked-uri": "https://evil.example/x.png",
        "document-uri": "http://localhost:3000/explore",
        "source-file": "http://localhost:3000/_next/static/chunks/app.js",
        "line-number": 42,
      },
    });

    const response = await postCspReport(request(body));

    expect(response.status).toBe(204);
    expect(mockAudit.warn).toHaveBeenCalledTimes(1);
    expect(mockAudit.warn).toHaveBeenCalledWith("csp_violation", {
      blockedUri: "https://evil.example/x.png",
      violatedDirective: "img-src",
      effectiveDirective: undefined,
      documentUri: "http://localhost:3000/explore",
      sourceFile: "http://localhost:3000/_next/static/chunks/app.js",
      lineNumber: 42,
      columnNumber: undefined,
      scriptSample: undefined,
      disposition: undefined,
      referrer: undefined,
    });
  });

  it("accepts modern Reporting API array payload and logs one warn per entry", async () => {
    const body = JSON.stringify([
      {
        type: "csp-violation",
        body: {
          blockedURL: "wss://evil.example/socket",
          effectiveDirective: "connect-src",
          documentURL: "http://localhost:3000/",
          disposition: "report",
        },
      },
      {
        type: "csp-violation",
        body: {
          blockedURL: "inline",
          effectiveDirective: "script-src",
          documentURL: "http://localhost:3000/dashboard",
        },
      },
    ]);

    const response = await postCspReport(request(body, "application/reports+json"));

    expect(response.status).toBe(204);
    expect(mockAudit.warn).toHaveBeenCalledTimes(2);
    expect(mockAudit.warn).toHaveBeenNthCalledWith(1, "csp_violation", expect.objectContaining({
      blockedUri: "wss://evil.example/socket",
      effectiveDirective: "connect-src",
      documentUri: "http://localhost:3000/",
      disposition: "report",
    }));
    expect(mockAudit.warn).toHaveBeenNthCalledWith(2, "csp_violation", expect.objectContaining({
      blockedUri: "inline",
      effectiveDirective: "script-src",
      documentUri: "http://localhost:3000/dashboard",
    }));
  });

  it("returns 204 on malformed JSON body and never throws", async () => {
    const response = await postCspReport(request("{not valid json"));
    expect(response.status).toBe(204);
    expect(mockAudit.warn).not.toHaveBeenCalled();
  });

  it("rejects oversized report bodies with 413", async () => {
    const response = await postCspReport(
      request(JSON.stringify({ sample: "x".repeat(17 * 1024) })),
    );

    expect(response.status).toBe(413);
    expect(mockAudit.warn).toHaveBeenCalledWith("csp_report_body_too_large", {
      byteLength: expect.any(Number),
      maxBytes: 16 * 1024,
    });
  });

  it("returns 204 on empty body and never throws", async () => {
    const response = await postCspReport(request(""));
    expect(response.status).toBe(204);
    expect(mockAudit.warn).not.toHaveBeenCalled();
  });
});
