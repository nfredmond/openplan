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

// StudyAreaPicker owns place search and a Mapbox surface, and has its own
// tests. Here it only needs to be able to report a resolved place, which is the
// contract this page depends on.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({
    onPlaceResolved,
  }: {
    onPlaceResolved?: (place: unknown) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onPlaceResolved?.({
            kind: "county",
            geoid: "39049",
            label: "Franklin County, Ohio",
            geojson: { type: "Polygon", coordinates: [] },
            bbox: { minLon: -83.1, minLat: 39.9, maxLon: -82.8, maxLat: 40.1 },
          })
        }
      >
        resolve county
      </button>
      <button
        type="button"
        onClick={() =>
          onPlaceResolved?.({
            kind: "city",
            geoid: "3918000",
            label: "Columbus, Ohio",
            geojson: { type: "Polygon", coordinates: [] },
            bbox: { minLon: -83.1, minLat: 39.9, maxLon: -82.8, maxLat: 40.1 },
          })
        }
      >
        resolve city
      </button>
    </div>
  ),
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

  it("creates a county run from a resolved county, deriving the FIPS", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.click(screen.getByRole("button", { name: /resolve county/i }));

    const runName = screen.getByRole("textbox");
    fireEvent.change(runName, { target: { value: "franklin-runtime-smoke" } });

    fireEvent.click(screen.getByRole("button", { name: /launch county/i }));

    await waitFor(() => {
      expect(createCountyRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "123e4567-e89b-12d3-a456-426614174000",
          geographyType: "county_fips",
          // Derived from the resolved county's GEOID, not hand-typed.
          geographyId: "39049",
          geographyLabel: "Franklin County, Ohio",
          runName: "franklin-runtime-smoke",
          runtimeOptions: expect.objectContaining({ keepProject: true }),
        }),
      );
    });

    // countyPrefix is no longer collected: it is optional on the request schema
    // and the server derives it from the label.
    expect(createCountyRunMock.mock.calls[0][0]).not.toHaveProperty("countyPrefix");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    });
  });

  it("refuses a non-county place and says which county to pick instead", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.click(screen.getByRole("button", { name: /resolve city/i }));

    // Disclose the limit, never silently apply it: a city has no county to
    // derive without guessing which one contains it.
    expect(screen.getByText(/County onboarding runs on a county/i)).toBeTruthy();
    expect(screen.getByText(/Columbus, Ohio is a city or town/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /launch county/i })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: /launch county/i }));
    expect(createCountyRunMock).not.toHaveBeenCalled();
  });

  it("cannot launch before a place is resolved", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);
    expect(screen.getByRole("button", { name: /launch county/i })).toHaveProperty("disabled", true);
  });

  it("names the run after the county when none is typed", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.click(screen.getByRole("button", { name: /resolve county/i }));
    fireEvent.click(screen.getByRole("button", { name: /launch county/i }));

    await waitFor(() => {
      expect(createCountyRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ runName: "franklin-county-ohio-runtime" }),
      );
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
