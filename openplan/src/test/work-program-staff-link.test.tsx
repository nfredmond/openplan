import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ReportingPanel } from "@/components/programs/work-program/reporting-panel";
import { StaffAndRatesPanel } from "@/components/invoicing/staff-and-rates-panel";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const workspaceId = "00000000-0000-4000-8000-000000000001", userId = "00000000-0000-4000-8000-000000000002";
function network() {
 const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method ? {} : { members: [{ userId, email: "synthetic@example.test", role: "member" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
 vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("creates linked staff through the existing staff API and retains the selected account on edits", async () => {
 const fetcher = network();
 const { unmount } = render(<StaffAndRatesPanel workspaceId={workspaceId} canWrite staff={[]} rateTables={[]} engagements={[]}/>);
 fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
 fireEvent.change(screen.getByLabelText("Staff name"), { target: { value: "Synthetic staff" } });
 await screen.findByRole("option", { name: /synthetic@example.test/ });
 fireEvent.change(screen.getByLabelText("Staff workspace account"), { target: { value: userId } });
 fireEvent.click(screen.getByRole("button", { name: "Create staff record" }));
 await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url === "/api/invoicing/staff" && init?.method === "POST")).toBe(true));
 expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string)).toMatchObject({ workspaceId, name: "Synthetic staff", userId });
 unmount();
 render(<StaffAndRatesPanel workspaceId={workspaceId} canWrite staff={[{ id: "staff", name: "Synthetic staff", title: null, defaultLaborCategory: null, active: true, userId }]} rateTables={[]} engagements={[]}/>);
 fireEvent.click(screen.getByRole("button", { name: "Edit" }));
 await screen.findByRole("option", { name: /synthetic@example.test/ });
 expect(screen.getByLabelText("Workspace account for Synthetic staff")).toHaveValue(userId);
 fireEvent.click(screen.getByRole("button", { name: "Save staff record" }));
 await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
 expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")![1]!.body as string)).toMatchObject({ workspaceId, userId });
});
it("loads staff account identity in the real projection", () => {
 const page = readFileSync("src/app/(app)/invoicing/_components/receivables-lane.tsx", "utf8");
 const projection = page.match(/\.from\("invoicing_staff"\)\s*\.select\("([^"]+)"\)/)?.[1];
 expect(projection?.split(", ")).toContain("user_id");
 expect(page).toContain("userId: member.user_id");
});

it.each([workspaceId, "00000000-0000-4000-8000-000000000003"])("keeps the program workspace %s when opening staff setup", async (programWorkspaceId) => {
 vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ revisions: [] }), { status: 200 })));
 render(<ReportingPanel programId="00000000-0000-4000-8000-000000000004" workspaceId={programWorkspaceId} userId={userId}/>);
 await screen.findByText("Save a preparation revision below before attributing actual work. Adopt a baseline before issuing a management report.");
 const target = new URL(screen.getByRole("link", { name: "Staff and account setup" }).getAttribute("href")!, "http://localhost");
 expect(target.pathname).toBe("/invoicing");
 expect(target.searchParams.get("workspaceId")).toBe(programWorkspaceId);
 expect(target.searchParams.get("direction")).toBe("receivables");
 expect(target.hash).toBe("#staff-time-access");
});
