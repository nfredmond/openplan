import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";
import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";

const enqueueMock = vi.fn();
const cancelMock = vi.fn();
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
    cancel: cancelMock,
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
    cancelMock.mockReset();
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

  it("replaces the generic prepared help text with what actually happened", () => {
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);

    const refusal = screen.getByTestId("county-enqueue-refusal");
    expect(refusal).toHaveTextContent(
      /no processing worker configured on this OpenPlan installation to run county validation/i
    );
    expect(refusal).toHaveTextContent(/no request was made and no setup started/i);
    // The generic help text does not say who will run the handoff; it must
    // not be on screen alongside the refusal, which does.
    expect(screen.queryByText(/prepared but has not been sent anywhere/i)).toBeNull();
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

    fireEvent.click(screen.getByRole("checkbox", { name: /worker has been configured on this OpenPlan installation/i }));
    fireEvent.click(screen.getByRole("button", { name: /Prepare run handoff/i }));

    expect(enqueueMock).toHaveBeenCalledWith(COUNTY_RUN_ID);
  });

  it("does not refuse a run that was really queued on a worker", () => {
    useCountyRunDetailMock.mockReturnValue({
      data: detailData({ enqueueStatus: "queued", workerUrl: "https://worker.example/jobs" }),
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);
    expect(screen.queryByTestId("county-enqueue-refusal")).toBeNull();
  });

  it("gives a planner a confirmed cancel control for an active attempt", async () => {
    const refresh = vi.fn();
    cancelMock.mockResolvedValue(true);
    useCountyRunDetailMock.mockReturnValue({
      data: detailData({ enqueueStatus: "running", workerUrl: "https://worker.example/jobs" }),
      loading: false,
      error: null,
      refresh,
    });
    render(<CountyRunDetailClient countyRunId={COUNTY_RUN_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      /partial files will remain in the attempt directory/i
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop this run" }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(COUNTY_RUN_ID));
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
    expect(disclosure).toHaveTextContent(/prepared rather than sent/i);
    expect(disclosure).toHaveTextContent(/does not run until whoever operates this OpenPlan installation/i);

    // The card for that same run must not contradict the disclosure two
    // elements above it: the shared prepared help text does not say that
    // nothing is going to run this handoff, and the card override does.
    expect(screen.queryByText(/prepared but has not been sent anywhere/i)).toBeNull();
    expect(screen.getByText(/prepared, not sent/i)).toBeInTheDocument();
  });

  /**
   * The disclosure above needs a run that was ALREADY prepared, so the first
   * county launch on a fresh deployment got nothing. Unlike the modeling
   * worker, this one is declared by configuration already — the page can hand
   * the answer down and the first launch can be honest.
   */
  it("says it before the first launch, on a deployment that declares no worker", () => {
    useCountyRunsMock.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() });

    render(
      <CountyRunsPageClient
        workspaceId="123e4567-e89b-12d3-a456-426614174000"
        countyOnrampWorkerConfigured={false}
      />
    );

    const disclosure = screen.getByTestId("county-worker-absent-disclosure");
    expect(disclosure).toHaveTextContent(/no processing worker configured to run county validation/i);
    // Nothing has been prepared here, so there is no record to cite as evidence.
    expect(disclosure).not.toHaveTextContent(/county run here was prepared/i);
    // The handoff lane stays real: this is a disclosure, not a dead end.
    expect(disclosure).toHaveTextContent(/payload is usable/i);
  });

  it("stops calling a launch a handoff once a worker is configured", () => {
    // Prepared records prove only what was true when they were made. With a
    // worker configured now, a launch really would be submitted, so repeating
    // the old disclosure would be the false statement.
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

    render(
      <CountyRunsPageClient
        workspaceId="123e4567-e89b-12d3-a456-426614174000"
        countyOnrampWorkerConfigured
      />
    );

    expect(screen.queryByTestId("county-worker-absent-disclosure")).toBeNull();
  });

  it("stays quiet when nothing has been prepared-without-a-worker here", () => {
    useCountyRunsMock.mockReturnValue({
      items: [
        {
          id: COUNTY_RUN_ID,
          geographyLabel: "Franklin County, Ohio",
          runName: "franklin-runtime",
          stage: "bootstrap-incomplete",
          enqueueStatus: "queued",
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
