import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import ExamplesEvidenceCatalogPage from "@/app/(public)/examples/page";

describe("ExamplesEvidenceCatalogPage", () => {
  it("positions examples as open-source proof, not a product tour or a sales path", () => {
    render(<ExamplesEvidenceCatalogPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source proof, then supervised service paths/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Inspect the proof trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Run it yourself/i)).toBeInTheDocument();
    expect(screen.getByText(/One example is not a guarantee/i)).toBeInTheDocument();
    expect(screen.queryByText(/Truth-state lock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Clone the proof trail/i)).not.toBeInTheDocument();
    expect(screen.getByText(/One completed run, verbatim/i)).toBeInTheDocument();
    expect(screen.queryByText(/One live run, verbatim/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Guided demo fit check/i)).toBeInTheDocument();
    expect(screen.getByText(/one concrete workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/a clear read on what your data does and does not support/i)).toBeInTheDocument();
    expect(screen.getByText(/Command Center handoff cue/i)).toBeInTheDocument();
    expect(screen.getByText(/name the proof boundary, show the internal prototype gate/i)).toBeInTheDocument();
    expect(screen.getByText(/preserve the Max APE caveat/i)).toBeInTheDocument();
    expect(screen.getByText(/supervised access or service-lane review/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed-in operators can return to the internal command surface/i)).toBeInTheDocument();
    expect(screen.getByText(/Copyable buyer evidence brief/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nevada County buyer evidence brief/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Static screening-run snapshot for supervised OpenPlan conversations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/internal prototype only; screening-grade only; not production model validation/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/237\.62% Max APE/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/does not prove current runtime state, calibrated forecasts/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scope one supervised first workflow: geography, data owner, review owner, hosting lane/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open operator Command Center/i })).toHaveAttribute(
      "href",
      "/command-center",
    );
    expect(document.body).not.toHaveTextContent(/validated forecast/i);
    expect(document.body).not.toHaveTextContent(/live run/i);
    expect(document.body).not.toHaveTextContent(/production data seeded/i);
    expect(document.body).not.toHaveTextContent(/automatic workspace provisioning/i);
    expect(document.body).not.toHaveTextContent(/instant customer activation/i);
    expect(screen.getByRole("link", { name: "Create your free workspace" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    // The page offers more than one route to contact; all must point at /contact.
    for (const link of screen.getAllByRole("link", { name: /Ask a question/i })) {
      expect(link).toHaveAttribute("href", "/contact");
    }
  });
});
