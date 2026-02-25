import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postReport } from "@/app/api/report/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/report", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ from: mockFrom });

    mockSingle.mockResolvedValue({
      data: {
        id: runId,
        title: "Test Corridor",
        query_text: "Evaluate this corridor",
        summary_text: "Summary text",
        ai_interpretation: "Interpretation text",
        metrics: {
          overallScore: 70,
          accessibilityScore: 68,
          safetyScore: 72,
          equityScore: 74,
          totalPopulation: 12345,
          totalTransitStops: 56,
          totalFatalCrashes: 3,
          justice40Eligible: true,
        },
        created_at: "2025-01-01T00:00:00.000Z",
      },
      error: null,
    });
  });

  it("returns 400 for invalid format", async () => {
    const response = await postReport(jsonRequest({ runId, format: "docx" }));

    expect(response.status).toBe(400);
  });

  it("returns html for format=html", async () => {
    const response = await postReport(jsonRequest({ runId, format: "html" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("returns pdf bytes for format=pdf", async () => {
    const response = await postReport(jsonRequest({ runId, format: "pdf" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 4));
    expect(signature).toBe("%PDF");
  });
});
