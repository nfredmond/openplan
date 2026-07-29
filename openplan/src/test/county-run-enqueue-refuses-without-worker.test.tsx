import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";
import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";

const enqueueMock = vi.fn();
const createCountyRunMock = vi.fn();
const useCountyRunDetailMock = vi.fn();
const useCountyRunsMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/county-runs",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: (...args: unknown[]) => useCountyRunsMock(...args),
  useCountyRunDetail: (...args: unknown[]) => useCountyRunDetailMock(...args),
  useCountyRunMutations: () => ({
    enqueue: enqueueMock,
    create: createCountyRunMock,
    loading: false,
    error: null,
  }),
}));

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function detailData(overrides: Record<string, unknown> = {}) {
  return {
    id: COUNTY_RUN_ID,
    geographyLabel: "Franklin County, Ohio",
    runName: "franklin-runtime",
    stage: "bootstrap-incomplete",
    statusLabel: null,
    manifest: null,
    artifacts: [],
    enqueueStatus: "prepared",
    lastEnqueuedAt: "2026-07-28T11:00:00Z",
    workerUrl: null,
    workerJobId: "job-1",
    workerPayload: null,
    workerDispatchError: null,
    ...overrides,
  };
}

describe("county run handoff where no county onramp worker is configured", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    createCountyRunMock.mockReset();
    useCountyRunDetailMock.mockReset();
    useCountyRunsMock.mockReset();
    useCountyRunDetailMock.mockReturnValue({
      data: detailData(),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("does not enqueue again into a handoff nothing will pick up", () => {
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);

    const button = screen.getByRole("button", { name: /No worker to hand this to/i });
    expect(button).toHaveProperty("disabled", true);

    fireEvent.click(button);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("replaces 'prepared for background execution' with what actually happened", () => {
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);

    const refusal = screen.getByTestId("county-enqueue-refusal");
    expect(refusal).toHaveTextContent(/no county onramp worker configured on this deployment/i);
    expect(refusal).toHaveTextContent(/no request was made and no bootstrap started/i);
    // The generic label promised background execution that was never going to
    // happen; it must not be on screen alongside the truth.
    expect(screen.queryByText(/prepared for background execution/i)).toBeNull();
  });

  it("keeps the manual lane usable instead of calling the run impossible", () => {
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);

    const refusal = screen.getByTestId("county-enqueue-refusal");
    expect(refusal).toHaveTextContent(/bootstrap_county_validation_onramp\.py/);
    expect(refusal).toHaveTextContent(/workers\/county_onramp_worker\/DEPLOY\.md/);
    expect(refusal.textContent ?? "").not.toMatch(/upgrade|subscription|billing|pricing/i);
  });

  it("lets an operator who has configured a worker try again", () => {
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /worker has been configured on this deployment/i }));
    fireEvent.click(screen.getByRole("button", { name: /Prepare run handoff/i }));

    expect(enqueueMock).toHaveBeenCalledWith(COUNTY_RUN_ID);
  });

  it("does not refuse a run that was really submitted to a worker", () => {
    useCountyRunDetailMock.mockReturnValue({
      data: detailData({ enqueueStatus: "submitted", workerUrl: "https://worker.example/jobs" }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);
    expect(screen.queryByTestId("county-enqueue-refusal")).toBeNull();
  });
});

describe("county run launch control on a deployment with no worker", () => {
  beforeEach(() => {
    useCountyRunsMock.mockReset();
    createCountyRunMock.mockReset();
  });

  it("says before the launch that this produces a handoff, not a run", () => {
    useCountyRunsMock.mockReturnValue({
      items: [
        {
          id: COUNTY_RUN_ID,
          geographyLabel: "Franklin County, Ohio",
          runName: "franklin-runtime",
          stage: "bootstrap-incomplete",
          enqueueStatus: "prepared",
          updatedAt: "2026-07-28T11:00:00Z",
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    const disclosure = screen.getByTestId("county-worker-absent-disclosure");
    expect(disclosure).toHaveTextContent(/prepared rather than submitted/i);
    expect(disclosure).toHaveTextContent(/does not execute until whoever operates this deployment/i);

    // The card for that same run must not contradict the disclosure two
    // elements above it: the shared help text's "prepared for background
    // execution" describes execution that nothing is going to perform.
    expect(screen.queryByText(/prepared for background execution/i)).toBeNull();
    expect(screen.getByText(/prepared, not submitted/i)).toBeInTheDocument();
  });

  it("stays quiet when nothing has been prepared-without-a-worker here", () => {
    useCountyRunsMock.mockReturnValue({
      items: [
        {
          id: COUNTY_RUN_ID,
          geographyLabel: "Franklin County, Ohio",
          runName: "franklin-runtime",
          stage: "bootstrap-incomplete",
          enqueueStatus: "submitted",
          updatedAt: "2026-07-28T11:00:00Z",
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);
    expect(screen.queryByTestId("county-worker-absent-disclosure")).toBeNull();
  });
});
