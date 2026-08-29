import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn();
const readDownload = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/models/published-structural-demand-diagnosis", () => ({ readPublishedStructuralDemandDownload: (...args: unknown[]) => readDownload(...args) }));

import { GET } from "@/app/api/models/structural-demand-diagnosis/[...parts]/route";

describe("published structural demand download route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires sign-in before reading an artifact", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ parts: ["study-result.json"] }) });
    expect(response.status).toBe(401);
    expect(readDownload).not.toHaveBeenCalled();
  });
  it("returns exact bytes with the hash header", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    readDownload.mockResolvedValue({ bytes: Buffer.from("exact"), contentType: "application/json", filename: "diagnosis.json", sha256: "d".repeat(64) });
    const response = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ parts: ["06007", "aequilibrae", "model-validation-structural-diagnosis-v3.json"] }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-openplan-sha256")).toBe("d".repeat(64));
    expect(await response.text()).toBe("exact");
  });
});
