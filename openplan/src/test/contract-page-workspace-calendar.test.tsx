import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  calendarRow: null as { time_zone: string | null; home_country_code: string | null } | null,
  calendarFrom: vi.fn(),
  calendarEq: vi.fn(),
}));

vi.mock("@/lib/invoicing/contracts/server", () => ({ contractAccess: mocks.access }));
vi.mock("@/components/invoicing/contracts/contract-management", () => ({
  ContractManagement: ({ timeZone }: { timeZone?: string }) => <div data-time-zone={timeZone ?? ""} />,
}));

import ContractPage from "@/app/(app)/invoicing/engagements/[engagementId]/page";

/**
 * The contract page reads the workspace calendar once and hands its zone to
 * the forms, which default their dates to today on it. Two zones, two answers,
 * so a page that hardcoded one cannot pass.
 */

const WORKSPACE = "70000000-0000-4000-8000-000000000001";

function service() {
  return {
    from: (table: string) => {
      mocks.calendarFrom(table);
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            mocks.calendarEq(column, value);
            return { maybeSingle: async () => ({ data: mocks.calendarRow, error: null }) };
          },
        }),
      };
    },
  };
}

async function renderedZone(): Promise<string | null> {
  const html = renderToStaticMarkup(await ContractPage({ params: Promise.resolve({ engagementId: "e-1" }) }));
  return /data-time-zone="([^"]*)"/.exec(html)?.[1] ?? null;
}

describe("the contract page passes the workspace calendar to its forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calendarRow = null;
    mocks.access.mockReset();
    mocks.access.mockImplementation(async () => ({
      service: service(),
      state: { engagement: { id: "e-1", workspace_id: WORKSPACE } },
    }));
  });

  it("passes the zone the workspace saved", async () => {
    for (const zone of ["Pacific/Honolulu", "Asia/Tokyo"]) {
      mocks.calendarRow = { time_zone: zone, home_country_code: null };
      expect(await renderedZone()).toBe(zone);
    }
    expect(mocks.calendarFrom).toHaveBeenCalledWith("workspaces");
    expect(mocks.calendarEq).toHaveBeenCalledWith("id", WORKSPACE);
  });

  it("passes UTC when the workspace has no zone", async () => {
    expect(await renderedZone()).toBe("UTC");
  });
});
