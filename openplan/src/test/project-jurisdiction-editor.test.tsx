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

for (const [name, change] of [
  ["account", { userId: "other-user" }], ["workspace", { workspaceId: "other-workspace" }],
  ["permission", { canWrite: false }], ["project", { projectId: "other-project" }],
  ["revision", { revision: "2026-10-16T00:00:00.000Z" }],
] as const) {
  it(`retains original draft and blocks ${name} props changes until explicit restart`, async () => {
    const view = render(<ProjectJurisdictionEditor {...props} />);
    fireEvent.click(screen.getByText("Edit jurisdiction context")); fireEvent.click(screen.getByText("Resolve jurisdiction"));
    view.rerender(<ProjectJurisdictionEditor {...props} {...change} />);
    expect(screen.queryByText(/county 06045/), "Retained draft survives changed props").toBeTruthy();
    expect((screen.getByText("Save jurisdiction context").closest("fieldset") as HTMLFieldSetElement).disabled, "Stale draft submission blocked").toBe(true);
    fireEvent.click(screen.getByText("Save jurisdiction context")); fireEvent.click(screen.getByText("Clear to unresolved"));
    expect(fetch, "Stale draft emits no request").not.toHaveBeenCalled();
    if (name !== "permission") {
      fireEvent.click(screen.getByText("Compare saved context and restart"));
      expect(screen.queryByText(/county 06045/), "Restart uses current saved context").toBeNull();
      fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
      await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe(`/api/projects/${{ ...props, ...change }.projectId}`);
      expect(options!.headers).toEqual({ "content-type": "application/json", "x-openplan-expected-user": { ...props, ...change }.userId, "x-openplan-expected-workspace": { ...props, ...change }.workspaceId });
      expect(JSON.parse(options!.body as string).expectedRevision).toBe({ ...props, ...change }.revision);
    }
  });
  it(`keeps draft when an in-flight save returns after ${name} changes`, async () => {
    let resolveResponse!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
    const view = render(<ProjectJurisdictionEditor {...props} />);
    fireEvent.click(screen.getByText("Edit jurisdiction context")); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
    view.rerender(<ProjectJurisdictionEditor {...props} {...change} />);
    resolveResponse(new Response("{}", { status: 200 }));
    await waitFor(() => expect(screen.queryByText(/save response belongs to an earlier scope/), "Earlier-scope response disclosed").toBeTruthy());
    expect(refresh, "Earlier-scope response cannot confirm new scope").not.toHaveBeenCalled();
    expect(screen.queryByText(/county 06045/), "Earlier-scope response preserves original draft").toBeTruthy();
  });
}
it("blocks an in-flight confirmation even when account changes away and back", async () => {
  let resolveResponse!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
  const view = render(<ProjectJurisdictionEditor {...props} />);
  fireEvent.click(screen.getByText("Edit jurisdiction context")); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  view.rerender(<ProjectJurisdictionEditor {...props} userId="other-user" />);
  view.rerender(<ProjectJurisdictionEditor {...props} />);
  resolveResponse(new Response("{}", { status: 200 }));
  await waitFor(() => expect(screen.queryByText(/save response belongs to an earlier scope/), "Earlier-scope response disclosed").toBeTruthy());
  expect(refresh, "An intervening account change invalidates confirmation").not.toHaveBeenCalled();
});

it("does not publish a prior-scope error after deferred response parsing", async () => {
  let resolveBody!: (value: { error: string }) => void;
  const json = vi.fn(() => new Promise(resolve => { resolveBody = resolve; }));
  vi.mocked(fetch).mockResolvedValue({ ok: false, json } as unknown as Response);
  const view = render(<ProjectJurisdictionEditor {...props} />);
  fireEvent.click(screen.getByText("Edit jurisdiction context")); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  await waitFor(() => expect(json).toHaveBeenCalledOnce());
  view.rerender(<ProjectJurisdictionEditor {...props} userId="other-user" />);
  resolveBody({ error: "Response for the original account" });
  await waitFor(() => expect(screen.queryByText(/save response belongs to an earlier scope/), "Parsed error stays with original scope").toBeTruthy());
  expect(screen.queryByText("Response for the original account"), "Prior account error does not enter new scope").toBeNull();
});
it("blocks confirmation after permission is revoked and restored during a save", async () => {
  let resolveResponse!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
  const view = render(<ProjectJurisdictionEditor {...props} />);
  fireEvent.click(screen.getByText("Edit jurisdiction context")); fireEvent.click(screen.getByText("Resolve jurisdiction")); fireEvent.click(screen.getByText("Save jurisdiction context"));
  view.rerender(<ProjectJurisdictionEditor {...props} canWrite={false} />);
  view.rerender(<ProjectJurisdictionEditor {...props} />);
  resolveResponse(new Response("{}", { status: 200 }));
  await waitFor(() => expect(screen.queryByText(/save response belongs to an earlier scope/), "Intervening permission loss invalidates confirmation").toBeTruthy());
  expect(refresh, "Restored permission cannot adopt earlier intent").not.toHaveBeenCalled();
});
