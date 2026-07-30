import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CountyRunValidationPrep } from "@/components/county-runs/county-run-validation-prep";
import type { PrepareCountyRunValidationResponse } from "@/lib/api/county-onramp";

/**
 * THE STEP WHERE AN OPERATOR GOT STUCK, WITH NOTHING ON SCREEN ABOUT IT.
 *
 * A county run becomes "validated screening" only after its assigned volumes are
 * checked against observed counts. `/api/county-runs/[id]/validate` already knew
 * whether that check could run, why not, and the exact
 * `validate_screening_observed_counts.py` invocation to use — and had no caller.
 * The page went quiet at exactly that point, so the only way to learn what was
 * missing was to run the script and read the traceback.
 */

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function prep(
  overrides: Partial<PrepareCountyRunValidationResponse> = {}
): PrepareCountyRunValidationResponse {
  return {
    countyRunId: RUN_ID,
    ready: true,
    statusLabel: "Ready to validate",
    reasons: [],
    command: "python3 'scripts/modeling/validate_screening_observed_counts.py' --run-output-dir '/runs/a/run_output'",
    automationCommand: null,
    refreshUrl: `https://openplan.example/api/county-runs/${RUN_ID}/validate/refresh`,
    callbackAuthMode: "session-only",
    runOutputDir: "/runs/a/run_output",
    countsCsvPath: "/runs/a/counts.csv",
    outputDir: "/runs/a/validation",
    projectDbPath: null,
    ...overrides,
  };
}

const renderPrep = () => render(<CountyRunValidationPrep countyRunId={RUN_ID} />);

const check = async () =>
  act(async () => fireEvent.click(screen.getByRole("button", { name: /check/i })));

describe("a county run can say whether it is ready to validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("asks nothing until it is asked", async () => {
    renderPrep();

    // The check probes this deployment's own filesystem, so its answer is only
    // true for this machine at this moment. Running it on mount would put a stat
    // behind every render and report a stale answer as a current one.
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("county-validation-prep")).toBeNull();
  });

  it("calls the route that had no caller", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => prep(),
    });

    renderPrep();
    await check();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/county-runs/${RUN_ID}/validate`,
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("names every reason the check is blocked, not just the first", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () =>
        prep({
          ready: false,
          statusLabel: "Validation prep blocked",
          reasons: [
            "Registered scaffold CSV file was not found on disk.",
            "Only 2 of 9 starter stations are validator-ready.",
          ],
          command: null,
        }),
    });

    renderPrep();
    await check();

    // Fixing one blocker and being told about the next one is the loop this
    // panel exists to collapse.
    expect(await screen.findByText(/scaffold CSV file was not found/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 9 starter stations/i)).toBeInTheDocument();
    expect(screen.getByText(/Validation prep blocked/i)).toBeInTheDocument();
  });

  it("offers no command when there is nothing runnable to offer", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => prep({ ready: false, reasons: ["County run directory is not recorded."], command: null }),
    });

    renderPrep();
    await check();

    await screen.findByTestId("county-validation-prep");
    expect(document.querySelector("pre")).toBeNull();
  });

  it("shows the assembled command with its paths resolved", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => prep(),
    });

    renderPrep();
    await check();

    expect(await screen.findByText(/validate_screening_observed_counts\.py/)).toBeInTheDocument();
  });

  it("only offers the callback variant when the token to use it exists", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => prep({ callbackAuthMode: "session-only", automationCommand: null }),
    });

    renderPrep();
    await check();

    // A copied command that fails at its last step with an auth error is worse
    // than one that was never offered — so say what is missing instead.
    expect(await screen.findByText(/callback bearer token this deployment has not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/post the results back/i)).toBeNull();
  });

  it("offers the callback variant when the deployment is configured for it", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () =>
        prep({
          callbackAuthMode: "bearer-env",
          automationCommand: "python3 validate.py && curl -sS -X POST 'https://openplan.example/refresh'",
        }),
    });

    renderPrep();
    await check();

    expect(await screen.findByText(/post the results back/i)).toBeInTheDocument();
  });

  it("does not report a failed check as a finding about the run", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to load county run" }),
    });

    renderPrep();
    await check();

    // "Not ready" and "we could not tell" send an operator to different places.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/problem reading the run, not a finding about it/i);
    expect(screen.queryByTestId("county-validation-prep")).toBeNull();
  });
});
