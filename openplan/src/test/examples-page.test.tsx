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
  it("positions examples as open-source proof with service paths instead of SaaS promises", () => {
    render(<ExamplesEvidenceCatalogPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source proof, then supervised service paths/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Inspect the proof trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Request implementation help/i)).toBeInTheDocument();
    expect(screen.getByText(/No instant checkout demo claim/i)).toBeInTheDocument();
    expect(screen.queryByText(/Truth-state lock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Clone the proof trail/i)).not.toBeInTheDocument();
    expect(screen.getByText(/One completed run, verbatim/i)).toBeInTheDocument();
    expect(screen.queryByText(/One live run, verbatim/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Guided demo fit check/i)).toBeInTheDocument();
    expect(screen.getByText(/one scoped first workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/self-hosted, managed-hosted, implementation-only, or a mix/i)).toBeInTheDocument();
    expect(screen.getByText(/Command Center handoff cue/i)).toBeInTheDocument();
    expect(screen.getByText(/name the proof boundary, show the internal prototype gate/i)).toBeInTheDocument();
    expect(screen.getByText(/preserve the Max APE caveat/i)).toBeInTheDocument();
    expect(screen.getByText(/supervised access or service-lane review/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed-in operators can return to the internal command surface/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open operator Command Center/i })).toHaveAttribute(
      "href",
      "/command-center",
    );
    expect(document.body).not.toHaveTextContent(/validated forecast/i);
    expect(document.body).not.toHaveTextContent(/production data seeded/i);
    expect(document.body).not.toHaveTextContent(/automatic workspace provisioning/i);
    expect(document.body).not.toHaveTextContent(/instant customer activation/i);
    expect(screen.getByRole("link", { name: "Review service lanes" })).toHaveAttribute(
      "href",
      "/pricing#service-lanes",
    );
    expect(screen.getByRole("link", { name: /Request supervised access/i })).toHaveAttribute(
      "href",
      "/request-access?lane=implementation",
    );
  });
});
