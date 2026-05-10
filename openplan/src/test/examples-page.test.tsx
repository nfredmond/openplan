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
    expect(screen.getByText(/Clone the proof trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Request implementation help/i)).toBeInTheDocument();
    expect(screen.getByText(/No subscription-first demo claim/i)).toBeInTheDocument();
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
