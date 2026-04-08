import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";

const pushMock = vi.fn();
const useCountyRunsMock = vi.fn();
const createCountyRunMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/county-runs",
  useSearchParams: () => new URLSearchParams("workspace=proof-beta"),
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: (...args: unknown[]) => useCountyRunsMock(...args),
  useCountyRunMutations: () => ({
    create: createCountyRunMock,
    loading: false,
    error: null,
  }),
}));

describe("CountyRunsPageClient", () => {
  beforeEach(() => {
    pushMock.mockReset();
    createCountyRunMock.mockReset();
    useCountyRunsMock.mockReset();

    useCountyRunsMock.mockReturnValue({
      items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          stage: "validated_screening",
          enqueueStatus: "not-enqueued",
          stageReasonLabel: "Observed counts available for comparison.",
          statusLabel: "Validation ready",
          updatedAtLabel: "Updated Apr 5, 2026",
          metrics: {
            zoneCount: "9",
            loadedLinks: "1,241",
            totalTrips: "20,668",
            finalGap: "0.0068",
            medianApe: "18%",
          },
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    createCountyRunMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
  });

  it("renders the current pilot validation list surface", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByText("County onboarding")).toBeInTheDocument();
    expect(screen.getByText(/25 most recent runs/i)).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.getByText("nevada-run")).toBeInTheDocument();
    expect(screen.getByText("Open detail")).toBeInTheDocument();
  });

  it("creates a county run and routes to the new detail page", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], {
      target: { value: "06061" },
    });
    fireEvent.change(inputs[1], {
      target: { value: "Placer County, CA" },
    });
    fireEvent.change(inputs[2], {
      target: { value: "PLACER" },
    });
    fireEvent.change(inputs[3], {
      target: { value: "placer-runtime-smoke" },
    });

    fireEvent.click(screen.getByRole("button", { name: /launch county/i }));

    await waitFor(() => {
      expect(createCountyRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "123e4567-e89b-12d3-a456-426614174000",
          geographyId: "06061",
          geographyType: "county_fips",
          geographyLabel: "Placer County, CA",
          countyPrefix: "PLACER",
          runName: "placer-runtime-smoke",
          runtimeOptions: expect.objectContaining({ keepProject: true }),
        }),
      );
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    });
  });

  it("shows the empty state when there are no county runs yet", () => {
    useCountyRunsMock.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByText(/no county runs yet/i)).toBeInTheDocument();
  });
});
