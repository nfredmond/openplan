import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: PropsWithChildren<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }
  >) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import HelpPage from "@/app/(app)/help/page";
import { ScreeningGradeLink } from "@/components/ui/screening-grade-link";
import { publishedValidationCeiling } from "@/lib/examples/published-ceiling";
import {
  describePublishedErrorEnvelope,
  SCREENING_GRADE_HELP_HREF,
  SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE,
  SCREENING_GRADE_SAFE_TO_CONCLUDE,
} from "@/lib/help/screening-grade";

/**
 * "SCREENING-GRADE" IS ASSERTED EVERYWHERE AND WAS DEFINED NOWHERE A PLANNER
 * COULD CLICK.
 *
 * Two properties are load-bearing and each has its own failure mode:
 *
 *  1. The explanation EXISTS at a reachable address, and says both halves — what
 *     you may conclude and what you may not. A page with only the caveats is a
 *     warning; a page with only the permissions is marketing.
 *  2. The error envelope is DERIVED from the published example records. A figure
 *     typed onto /help would keep quoting the old ceiling forever after a new
 *     validation example publishes, and nothing on screen would look wrong.
 */

describe("the one explanation of screening-grade", () => {
  it("lives at the address every badge points to", () => {
    render(<ScreeningGradeLink />);
    expect(screen.getByRole("link", { name: "screening-grade" })).toHaveAttribute(
      "href",
      SCREENING_GRADE_HELP_HREF
    );
    // The anchor is what makes the link land on the section rather than the top
    // of a long page.
    expect(SCREENING_GRADE_HELP_HREF).toBe("/help#screening-grade");
  });

  it("/help answers what it means, what it permits, and what it does not", () => {
    render(<HelpPage />);
    const section = document.getElementById("screening-grade");
    expect(section).not.toBeNull();
    const body = within(section as HTMLElement);

    expect(body.getByText(/What .screening-grade. means/)).toBeInTheDocument();
    // Both halves. Sampling one item from each list is enough to tell the lists
    // apart from an empty render.
    expect(body.getByText(SCREENING_GRADE_SAFE_TO_CONCLUDE[0])).toBeInTheDocument();
    expect(body.getByText(SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE[0])).toBeInTheDocument();
    expect(body.getByText(/It is not a forecast/)).toBeInTheDocument();
    expect(body.getByText(/not a CEQA determination/)).toBeInTheDocument();
  });

  it("states the error envelope by computing it, and names the record it came from", () => {
    render(<HelpPage />);
    const section = document.getElementById("screening-grade") as HTMLElement;
    const ceiling = publishedValidationCeiling();

    const envelope = within(section).getByText(
      new RegExp(
        `maximum absolute percent error of ${String(ceiling.maxApePercent).replace(".", "\\.")}%`
      )
    );
    expect(envelope.textContent).toContain(ceiling.label);
    expect(envelope.textContent).toContain(ceiling.runDate);
    // It must not be read as a measurement of the planner's own run.
    expect(envelope.textContent).toMatch(/not a measurement of any particular run/);
    expect(describePublishedErrorEnvelope()).toContain(String(ceiling.maxApePercent));
  });

  it("no page restates the envelope figure as a literal", () => {
    // The same rule /legal already lives under. A second copy of the number is a
    // second thing to remember to update, and the one nobody updates is the one
    // a planner reads.
    const pages = [
      path.join(process.cwd(), "src", "app", "(app)", "help", "page.tsx"),
      path.join(process.cwd(), "src", "lib", "help", "screening-grade.ts"),
    ];
    const literal = String(publishedValidationCeiling().maxApePercent);
    for (const page of pages) {
      expect(
        readFileSync(page, "utf8").includes(literal),
        `${path.relative(process.cwd(), page)} restates the published ceiling as a literal`
      ).toBe(false);
    }
  });
});

/**
 * THE BADGES THEMSELVES. A definition nothing links to is the state this lane
 * exists to end, so the link is asserted on the surfaces that assert the grade —
 * rendering the real components, never a fixture describing them.
 */
describe("the surfaces that assert the grade link to the explanation", () => {
  it("the model run's zone-resolution advice links out", async () => {
    const { ModelRunZoneResolutionPanel } = await import(
      "@/components/models/model-run-zone-resolution-panel"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          kpis: [
            {
              kpi_name: "intrazonal_trip_share",
              value: 36,
              breakdown_json: {
                zone_count: 26,
                zone_geography: "tract",
                supports_link_level_validation: false,
                interpretation: "More than a third of travel never reaches the network.",
              },
            },
          ],
        }),
      })
    );

    render(<ModelRunZoneResolutionPanel modelId="model-1" modelRunId="run-1" />);
    const link = await screen.findByRole("link", { name: "screening-grade" });
    expect(link).toHaveAttribute("href", SCREENING_GRADE_HELP_HREF);
    vi.unstubAllGlobals();
  });

  it("the county-run results panel links out", async () => {
    const { CountyRunBehavioralKpisSection } = await import(
      "@/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis"
    );
    render(
      <CountyRunBehavioralKpisSection
        countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        kpis={[]}
        isThisRunRejected={false}
        rejectedTotalCount={0}
        acceptingScreeningGrade={false}
        basePathname="/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        error={null}
      />
    );
    expect(screen.getByRole("link", { name: "screening-grade" })).toHaveAttribute(
      "href",
      SCREENING_GRADE_HELP_HREF
    );
  });
});
