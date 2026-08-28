import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

import { WorkspaceSwitchButton, WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher";

const TWO = [
  { id: "ws-1", name: "Nevada County" },
  { id: "ws-2", name: "Foothills MPO" },
];

function mockFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body ?? {},
      } as Response;
    })
  );
  return calls;
}

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders plain text when there is only one workspace", () => {
    render(
      <WorkspaceSwitcher
        workspaces={[{ id: "ws-1", name: "Nevada County" }]}
        currentWorkspaceId="ws-1"
        currentWorkspaceName="Nevada County"
      />
    );
    expect(screen.getByText("Nevada County")).toBeInTheDocument();
    // No trigger button to open a menu.
    expect(screen.queryByRole("button", { name: /Nevada County/i })).not.toBeInTheDocument();
  });

  it("switches the active workspace and refreshes", async () => {
    const calls = mockFetch({ ok: true, body: { workspaceId: "ws-2" } });

    render(
      <WorkspaceSwitcher workspaces={TWO} currentWorkspaceId="ws-1" currentWorkspaceName="Nevada County" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Nevada County/i }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("button", { name: /Foothills MPO/i }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toBe("/api/workspaces/active");
    expect(calls[0]!.body).toEqual({ workspaceId: "ws-2" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a switch failure instead of silently refreshing", async () => {
    mockFetch({ ok: false, status: 404, body: { error: "Workspace not found" } });

    render(
      <WorkspaceSwitcher workspaces={TWO} currentWorkspaceId="ws-1" currentWorkspaceName="Nevada County" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Nevada County/i }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("button", { name: /Foothills MPO/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Workspace not found/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not call the API when re-selecting the current workspace", async () => {
    const calls = mockFetch({ ok: true });

    render(
      <WorkspaceSwitcher workspaces={TWO} currentWorkspaceId="ws-1" currentWorkspaceName="Nevada County" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Nevada County/i }));
    const listbox = await screen.findByRole("listbox");
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("button", { name: /Nevada County/i }));
    });

    expect(calls.length).toBe(0);
  });

  it("opens a known workspace directly from a waiting-work notice", async () => {
    const calls = mockFetch({ ok: true, body: { workspaceId: "ws-2" } });

    render(<WorkspaceSwitchButton workspaceId="ws-2" workspaceName="Foothills MPO" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Foothills MPO" }));

    await waitFor(() => expect(calls).toEqual([{
      url: "/api/workspaces/active",
      body: { workspaceId: "ws-2" },
    }]));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("keeps a direct waiting-work switch failure visible", async () => {
    mockFetch({ ok: false, status: 404, body: { error: "Workspace not found" } });

    render(<WorkspaceSwitchButton workspaceId="ws-2" workspaceName="Foothills MPO" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Foothills MPO" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
