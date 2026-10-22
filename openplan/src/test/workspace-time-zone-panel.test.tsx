import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceTimeZonePanel } from "@/components/workspaces/workspace-time-zone-panel";

/**
 * The time zone control on Workspace setup. The browser's zone is a
 * suggestion: it is preselected for an owner, labelled as not saved, and
 * nothing is sent until Save is pressed.
 */

type FetchCall = { url: string; init?: RequestInit };
let fetchCalls: FetchCall[] = [];
let browserZone = "America/Denver";

const UTC_FALLBACK = { timeZone: "UTC", source: "utc_fallback" as const };

beforeEach(() => {
  fetchCalls = [];
  browserZone = "America/Denver";
  const RealDateTimeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(((locales?: string | string[], options?: Intl.DateTimeFormatOptions) => {
    const real = new RealDateTimeFormat(locales, options);
    if (options?.timeZone) return real;
    return Object.assign(Object.create(real), {
      resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: browserZone }),
    });
  }) as unknown as typeof Intl.DateTimeFormat);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      const body = JSON.parse(String(init?.body ?? "{}")) as { timeZone: string | null };
      return new Response(JSON.stringify({ workspaceId: "w-1", timeZone: body.timeZone }), { status: 200 });
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkspaceTimeZonePanel", () => {
  it("suggests the browser's zone to an owner without saving it", async () => {
    render(
      <WorkspaceTimeZonePanel
        workspaceId="w-1"
        canManage
        savedTimeZone={null}
        effective={UTC_FALLBACK}
        fallback={UTC_FALLBACK}
        unreadable={false}
      />
    );
    expect(screen.getByText("Not set. Dates use UTC.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("America/Denver"));
    expect(screen.getByText("Suggested from this browser. Not saved.")).toBeInTheDocument();
    expect(fetchCalls).toHaveLength(0);
  });

  it("saves the chosen zone through the settings route", async () => {
    render(
      <WorkspaceTimeZonePanel
        workspaceId="w-1"
        canManage
        savedTimeZone={null}
        effective={UTC_FALLBACK}
        fallback={UTC_FALLBACK}
        unreadable={false}
      />
    );
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("America/Denver"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "America/Chicago" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Dates use America/Chicago.")).toBeInTheDocument());
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/workspaces/home-geography");
    expect(fetchCalls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ workspaceId: "w-1", timeZone: "America/Chicago" });
  });

  it("shows a viewer the zone in use and no control", () => {
    render(
      <WorkspaceTimeZonePanel
        workspaceId="w-1"
        canManage={false}
        savedTimeZone="America/Chicago"
        effective={{ timeZone: "America/Chicago", source: "workspace_setting" }}
        fallback={UTC_FALLBACK}
        unreadable={false}
      />
    );
    expect(screen.getByText("Dates use America/Chicago.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("says a failed read is a failed read", () => {
    render(
      <WorkspaceTimeZonePanel
        workspaceId="w-1"
        canManage
        savedTimeZone={null}
        effective={UTC_FALLBACK}
        fallback={UTC_FALLBACK}
        unreadable
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The time zone could not be read.");
    expect(screen.queryByText("Not set. Dates use UTC.")).toBeNull();
  });

  it("offers no control on a database that does not have the setting yet", () => {
    render(
      <WorkspaceTimeZonePanel
        workspaceId="w-1"
        canManage
        savedTimeZone={null}
        effective={UTC_FALLBACK}
        fallback={UTC_FALLBACK}
        unreadable={false}
        unavailable
      />
    );
    expect(screen.getByText("Dates use UTC. This setting is not available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
