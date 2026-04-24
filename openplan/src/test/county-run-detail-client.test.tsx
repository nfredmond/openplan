import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";

const enqueueMock = vi.fn();
const clipboardWriteTextMock = vi.fn();
const useCountyRunDetailMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  useSearchParams: () => new URLSearchParams("workspace=proof-beta"),
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRunDetail: (...args: unknown[]) => useCountyRunDetailMock(...args),
  useCountyRunMutations: () => ({
    enqueue: enqueueMock,
    create: vi.fn(),
    loading: false,
    error: null,
  }),
}));

describe("CountyRunDetailClient", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    clipboardWriteTextMock.mockReset();
    useCountyRunDetailMock.mockReset();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://openplan.example/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?workspace=proof-beta"),
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });

    useCountyRunDetailMock.mockReturnValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-run",
        stage: "validated_screening",
        enqueueStatus: "not_enqueued",
        manifest: {
          geographyLabel: "Nevada County, CA",
          geographySlug: "nevada-county-ca",
          stageLabel: "Validated Screening",
          stageReasonLabel: "Observed counts available for comparison.",
          artifacts: [
            {
              label: "Validation summary",
              relativePath: "validation/validation_summary.json",
            },
          ],
        },
        artifacts: [
          {
            label: "Validation summary",
            relativePath: "validation/validation_summary.json",
          },
        ],
        modelingEvidence: {
          claimDecision: {
            track: "assignment",
            claimStatus: "screening_grade",
            statusReason: "Worst matched facility APE exceeds the claim-grade threshold.",
            reasons: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
            validationSummary: {
              passed: 3,
              warned: 0,
              failed: 1,
              missingRequiredMetricKeys: [],
              requiredMetricKeys: ["assignment_final_gap", "count_station_matches"],
            },
            decidedAt: "2026-03-24T23:00:00Z",
          },
          reportLanguage:
            "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.",
          sourceManifests: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              sourceKey: "census_tiger_boundary",
              sourceKind: "census_tiger",
              sourceLabel: "County boundary and tract geography",
              sourceUrl: "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html",
              sourceVintage: "2026",
              geographyId: "06057",
              geographyLabel: "Nevada County, CA",
              licenseNote: "U.S. Census public data.",
              citationText: "U.S. Census TIGER/Line geography for Nevada County, CA.",
            },
          ],
          validationResults: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              track: "assignment",
              metricKey: "critical_absolute_percent_error",
              metricLabel: "Critical facility absolute percent error",
              observedValue: 237.62,
              thresholdValue: 50,
              thresholdMaxValue: null,
              thresholdComparator: "lte",
              status: "fail",
              blocksClaimGrade: true,
              detail: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
              sourceManifestId: null,
              evaluatedAt: "2026-03-24T23:00:00Z",
            },
          ],
        },
        workerPayload: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    enqueueMock.mockResolvedValue({
      workerPayload: {
        callback: {
          manifestIngestUrl: "https://openplan.example/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
        },
      },
    });
  });

  it("renders the current operational detail surface", () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.getByText("County onboarding")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.getByText(/this page is the operational truth surface/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prepare run handoff/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy page link/i })).toBeInTheDocument();
  });

  it("renders structured modeling evidence and claim posture", () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.getByText("Modeling evidence")).toBeInTheDocument();
    expect(screen.getByText("Screening-grade")).toBeInTheDocument();
    expect(screen.getByText(/Screening-grade modeling result/i)).toBeInTheDocument();
    expect(screen.getByText("Critical facility absolute percent error")).toBeInTheDocument();
    expect(screen.getByText("County boundary and tract geography")).toBeInTheDocument();
  });

  it("copies the detail link", async () => {
    clipboardWriteTextMock.mockResolvedValue(undefined);

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    fireEvent.click(screen.getByRole("button", { name: /copy page link/i }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?workspace=proof-beta",
      );
    });

    expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("enqueues the run handoff", async () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    fireEvent.click(screen.getByRole("button", { name: /prepare run handoff/i }));

    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    });
  });
});
