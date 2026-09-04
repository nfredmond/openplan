import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const jurisdictionMaybeSingleMock = vi.fn();
const workspaceSelectedColumns: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: (_props: unknown) => <div data-testid="study-area-picker" />,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) =>
    loadCurrentWorkspaceMembershipMock(...args),
}));

import LandUsePlansPage from "@/app/(app)/land-use-plans/page";
import { HOME_JURISDICTION_COLUMNS } from "@/lib/workspaces/home-geography";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "land_use_plans") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "workspaces") {
        return {
          select: (columns: string) => {
            workspaceSelectedColumns.push(columns);
            return {
              eq: () => ({
                maybeSingle: async () => {
                  const result = await jurisdictionMaybeSingleMock();
                  if (!result.data || typeof result.data !== "object") return result;
                  const row = result.data as Record<string, unknown>;
                  const requested = columns.split(",").map((column) => column.trim());
                  return {
                    ...result,
                    data: Object.fromEntries(
                      requested
                        .filter((column) => column in row)
                        .map((column) => [column, row[column]])
                    ),
                  };
                },
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

async function renderPage() {
  render((await LandUsePlansPage()) as ReactNode);
}

describe("Land Use Plans first-run legal bundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceSelectedColumns.length = 0;
    createClientMock.mockResolvedValue(client());
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner" },
      workspace: { id: WORKSPACE_ID, name: "Any Agency" },
    });
    jurisdictionMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "OR",
      },
      error: null,
    });
  });

  it("selects the configured bundle for a matching workspace geography", async () => {
    jurisdictionMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });

    await renderPage();

    expect(screen.getByLabelText("Legal bundle")).toHaveValue("us-ca-general-plan");
    expect(screen.getByText(/recommended from this workspace's home geography/i)).toBeVisible();
    expect(workspaceSelectedColumns).toEqual([HOME_JURISDICTION_COLUMNS]);
  });

  it("selects the neutral workflow when no configured bundle covers the workspace", async () => {
    await renderPage();

    expect(screen.getByLabelText("Legal bundle")).toHaveValue("local-unconfigured");
    expect(screen.getByText(/No jurisdiction-specific legal bundle is configured/i)).toBeVisible();
    expect(screen.queryByRole("option", { name: "California" })).toBeNull();
  });

  it("does not turn a failed jurisdiction read into a claim that no law exists", async () => {
    jurisdictionMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await renderPage();

    expect(screen.getByLabelText("Legal bundle")).toHaveValue("local-unconfigured");
    expect(
      screen.getByText(/This page could not read this workspace's home jurisdiction/i)
    ).toBeVisible();
    expect(
      screen.getByText(/OpenPlan could not read this workspace's home jurisdiction/i)
    ).toBeVisible();
    expect(screen.queryByText(/No jurisdiction-specific legal bundle is configured/i)).toBeNull();
  });

  it("does not offer another jurisdiction's configured legal bundle as an override", async () => {
    await renderPage();

    expect(screen.getByLabelText("Legal bundle")).toHaveValue("local-unconfigured");
    expect(screen.queryByRole("option", { name: "California" })).toBeNull();
  });
});
