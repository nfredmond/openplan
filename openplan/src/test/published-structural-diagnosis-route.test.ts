import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();
const readDownload = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/models/published-structural-diagnosis", () => ({
  readPublishedStructuralDiagnosisDownload: (...args: unknown[]) => readDownload(...args),
}));

import { GET } from "@/app/api/models/validation-structural-diagnosis/[...parts]/route";

describe("published structural diagnosis download route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ parts: ["study-result.json"] }),
    });
    expect(response.status).toBe(401);
    expect(readDownload).not.toHaveBeenCalled();
  });

  it("returns exact bytes and their hash", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    readDownload.mockResolvedValue({
      bytes: Buffer.from('{"scientific_outcome":"inconclusive"}'),
      contentType: "application/json",
      filename: "structural-diagnosis.json",
      sha256: "d".repeat(64),
    });
    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ parts: ["06007", "aequilibrae", "structural-diagnosis.json"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="structural-diagnosis.json"',
    );
    expect(response.headers.get("x-openplan-sha256")).toBe("d".repeat(64));
    expect(await response.text()).toBe('{"scientific_outcome":"inconclusive"}');
  });
});
