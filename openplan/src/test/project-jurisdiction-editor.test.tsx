import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/models/study-area-picker", () => ({ StudyAreaPicker: ({ searchOnly, onCorridorChange, onPlaceResolved }: { searchOnly: boolean; onCorridorChange: (value: string) => void; onPlaceResolved: (value: unknown) => void }) => <button onClick={() => { expect(searchOnly).toBe(true); onCorridorChange("untrusted geometry callback"); onPlaceResolved({ kind: "county", geoid: "06045", label: "Search label" }); }}>Resolve jurisdiction</button> }));
import { ProjectJurisdictionEditor } from "@/components/projects/project-jurisdiction-editor";
const props = { projectId: "project", context: null, revision: "2026-10-15T00:00:00.000Z", userId: "user", workspaceId: "workspace", canWrite: true };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))); });
afterEach(cleanup);
function edit() { render(<ProjectJurisdictionEditor {...props} />); fireEvent.click(screen.getByRole("button", { name: "Edit jurisdiction context" })); }
it("cancels a local jurisdiction draft without writing", () => {
  edit(); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Cancel jurisdiction edit"));
  expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByText("Save jurisdiction context")).toBeNull();
});
it("saves references independently with account workspace and captured revision", async () => {
  edit(); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  expect((screen.getByText("Resolve jurisdiction").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/projects/project");
  expect(JSON.parse(options!.body as string)).toEqual({ expectedRevision: props.revision, jurisdiction: { version: 1, state: "declared", entries: [{ mode: "resolved", kind: "county", geoid: "06045" }] } });
  expect(options!.headers).toEqual({ "content-type": "application/json", "x-openplan-expected-user": "user", "x-openplan-expected-workspace": "workspace" });
});
it("retains the draft on conflict and clears only to explicit unresolved", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "The project changed. Keep your draft." }), { status: 409 }));
  edit(); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  await screen.findByRole("alert"); expect(screen.queryByText(/county 06045/), "The exact selected jurisdiction draft remains after a conflict").toBeTruthy(); expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Clear to unresolved"));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).jurisdiction).toEqual({ version: 1, state: "unresolved", entries: [] });
});
it("offers explicitly unverified staff entry without inventing resolved identity", async () => {
  edit(); fireEvent.change(screen.getByLabelText("Jurisdiction label"), { target: { value: "Sovereign declaration" } });
  fireEvent.change(screen.getByLabelText("Source-defined kind"), { target: { value: "nation" } });
  fireEvent.click(screen.getByText("Add staff declaration")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).jurisdiction.entries).toEqual([{ mode: "staff", label: "Sovereign declaration", kind: "nation", countryCode: null, subdivisionCode: null, reference: null, scope: "other" }]);
});
