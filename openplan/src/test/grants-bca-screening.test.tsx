import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BcaScreeningBody } from "@/components/grants/bca-screening-body";
import { GrantsBcaScreeningSection } from "@/components/grants/grants-bca-screening-section";
import { BCA_SCREENING_CAVEAT } from "@/lib/bca";

const PROJECTS = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "SR-49 Corridor Safety",
    // NUMERIC arrives from Supabase as a string.
    fundingNeedAmount: "2500000",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Downtown Complete Streets",
    fundingNeedAmount: null,
  },
];

function setInput(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("BcaScreeningBody", () => {
  it("renders the honest empty state until an operator supplies a cost or benefit", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    expect(screen.getByTestId("bca-empty-state")).toBeTruthy();
    expect(screen.queryByTestId("bca-determination")).toBeNull();
  });

  it("computes a determination from operator-supplied costs and benefits", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Annual commuter person-hours saved", "20000");

    const determination = screen.getByTestId("bca-determination");
    expect(determination.textContent).toContain("benefit-cost ratio");
    expect(screen.queryByTestId("bca-empty-state")).toBeNull();
  });

  it("pins the screening caveat verbatim on the determination", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Annual commuter person-hours saved", "20000");

    expect(screen.getByTestId("bca-caveat").textContent).toBe(BCA_SCREENING_CAVEAT);
  });

  it("prefills the capital cost from the selected project's recorded funding need", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    fireEvent.change(screen.getByLabelText("Project for benefit-cost screening"), {
      target: { value: PROJECTS[0].id },
    });

    const capitalInput = screen.getByLabelText("Capital cost in dollars") as HTMLInputElement;
    expect(capitalInput.value).toBe("2500000");
    expect(screen.getByText(/prefilled from the project/i)).toBeTruthy();
  });

  it("does not prefill when the project has no recorded funding need", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    fireEvent.change(screen.getByLabelText("Project for benefit-cost screening"), {
      target: { value: PROJECTS[1].id },
    });

    const capitalInput = screen.getByLabelText("Capital cost in dollars") as HTMLInputElement;
    expect(capitalInput.value).toBe("");
  });

  it("clears a stale prefill when switching to a project without a recorded need", () => {
    // Regression: the previous project's prefill used to survive the switch,
    // misattributing its cost to the newly selected project.
    render(<BcaScreeningBody projects={PROJECTS} />);
    const projectSelect = screen.getByLabelText("Project for benefit-cost screening");
    fireEvent.change(projectSelect, { target: { value: PROJECTS[0].id } });
    expect((screen.getByLabelText("Capital cost in dollars") as HTMLInputElement).value).toBe("2500000");

    fireEvent.change(projectSelect, { target: { value: PROJECTS[1].id } });
    expect((screen.getByLabelText("Capital cost in dollars") as HTMLInputElement).value).toBe("");
  });

  it("blocks the run and names the field when an input is not a number", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "about a million");
    setInput("Annual commuter person-hours saved", "20000");

    const issues = screen.getByTestId("bca-input-issues");
    expect(issues.textContent).toContain("Capital cost is not a number.");
    expect(screen.queryByTestId("bca-determination")).toBeNull();
  });

  it("accepts natural currency formatting with commas and a dollar sign", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "$1,000,000");
    setInput("Annual commuter person-hours saved", "20000");

    expect(screen.queryByTestId("bca-input-issues")).toBeNull();
    expect(screen.getByTestId("bca-determination")).toBeTruthy();
  });

  it("blocks the run when the capital spread exceeds the analysis horizon", () => {
    // Regression: the engine clips capital slices past the horizon, which
    // silently dropped cost and could flip the BCR verdict favorable.
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Annual commuter person-hours saved", "20000");
    setInput("Analysis horizon in years", "5");
    setInput("Years to spread capital cost over", "10");

    const issues = screen.getByTestId("bca-input-issues");
    expect(issues.textContent).toContain("Capital spread exceeds the analysis horizon");
    expect(screen.queryByTestId("bca-determination")).toBeNull();
  });

  it("blocks the run instead of coercing a fractional capital spread", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Years to spread capital cost over", "2.5");

    expect(screen.getByTestId("bca-input-issues").textContent).toContain(
      "Capital spread must be a whole number of years"
    );
    expect(screen.queryByTestId("bca-determination")).toBeNull();
  });

  it("excludes emissions-side strategies from the VMT derivation picker and shows the TDM caveat", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    expect(screen.queryByLabelText("Include EV Charging Stations")).toBeNull();

    fireEvent.click(screen.getByLabelText("Include Unbundled Parking"));
    expect(screen.getByTestId("bca-tdm-caveat")).toBeTruthy();
  });

  it("derives a VMT reduction from TDM strategies and applies it to the benefit input", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Base annual VMT affected by TDM strategies", "1000000");
    fireEvent.click(screen.getByLabelText("Include Unbundled Parking"));
    fireEvent.click(screen.getByLabelText("Include Transit Pass Subsidy"));

    expect(screen.getByTestId("bca-tdm-summary")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use as VMT reduced" }));

    const vmtInput = screen.getByLabelText(
      "Annual vehicle miles traveled reduced"
    ) as HTMLInputElement;
    // 1 - (0.95 × 0.935) = 0.11175 → 111,750 of 1,000,000 (multiplicative dampening).
    expect(vmtInput.value).toBe("111750");
  });

  it("recomputes the determination when the O&M cost changes after first render", () => {
    // Regression: annualOmInput was missing from the analysis memo's dependency
    // array, so editing O&M silently left the result stale.
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Annual commuter person-hours saved", "20000");
    const before = screen.getByTestId("bca-determination").textContent;

    setInput("Annual operations and maintenance cost", "250000");
    const after = screen.getByTestId("bca-determination").textContent;
    expect(after).not.toBe(before);
  });

  it("runs the seeded uncertainty screen on demand and reports P(BCR ≥ 1)", () => {
    render(<BcaScreeningBody projects={PROJECTS} />);
    setInput("Capital cost in dollars", "1000000");
    setInput("Annual commuter person-hours saved", "20000");
    fireEvent.click(screen.getByLabelText("Run uncertainty screen"));

    const summary = screen.getByTestId("bca-mc-summary");
    expect(summary.textContent).toContain("1000");
    expect(summary.textContent).toContain("probability BCR ≥ 1.0");
  });
});

describe("GrantsBcaScreeningSection", () => {
  it("mounts the wrapper with the screening-level badge and stable anchor id", () => {
    render(<GrantsBcaScreeningSection projects={PROJECTS} />);
    const article = screen.getByTestId("grants-bca-screening");
    expect(article.id).toBe("grants-benefit-cost");
    expect(article.textContent).toContain("Screening-level — not an application BCA");
  });
});
