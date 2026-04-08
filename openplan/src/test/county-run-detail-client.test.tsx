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
