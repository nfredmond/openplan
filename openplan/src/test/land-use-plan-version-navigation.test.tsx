import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(app)/land-use-plans/[planId]/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: () => null }));
const planId = "11111111-1111-4111-8111-111111111111";

describe("plan version page navigation", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "SYNTHETIC read refusal" }, { status: 503 }))); });

  it.each([undefined, "22222222-2222-4222-8222-222222222222", "", "bad&versionId=another"])("passes the exact selected version to the workbench request: %s", async versionId => {
    render(await Page({ params: Promise.resolve({ planId }), searchParams: Promise.resolve({ versionId }) }));
    const query = versionId === undefined ? "" : `?versionId=${encodeURIComponent(versionId)}`;
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/land-use-plans/${planId}${query}`, { cache: "no-store" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SYNTHETIC read refusal. This is a read failure, not an empty plan.");
  });

  it("refuses multiple version selections before mounting a workbench", async () => {
    render(await Page({ params: Promise.resolve({ planId }), searchParams: Promise.resolve({ versionId: ["one", "two"] }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose one plan version to open.");
    expect(fetch).not.toHaveBeenCalled();
  });
});
