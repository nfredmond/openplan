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

import PricingPage from "@/app/(public)/pricing/page";

describe("PricingPage", () => {
  it("frames OpenPlan as open-source software with managed hosting and services, not subscription-first SaaS", () => {
    render(<PricingPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source planning software, with managed hosting and implementation help/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Apache-2.0 source code license/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Open-source proof path/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source repository/i })).toHaveAttribute(
      "href",
      "https://github.com/nfredmond/openplan",
    );
    expect(screen.getByRole("link", { name: /Apache-2.0 license text/i })).toHaveAttribute(
      "href",
      "https://github.com/nfredmond/openplan/blob/main/LICENSE",
    );
    expect(screen.getByText(/Managed hosting \+ support/i)).toBeInTheDocument();
    expect(screen.getByText(/Implementation \+ planning services/i)).toBeInTheDocument();
    expect(screen.getByText(/Signed-in planning workspace, Analysis Studio access/i)).toBeInTheDocument();
    expect(screen.getByText(/Stripe remains the payment rail for hosted workspace support and service retainers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/historical live payment.*current non-money-moving billing checks/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/No new same-cycle paid checkout was run/i)).toBeInTheDocument();
    expect(screen.queryByText(/Operator-grade app shell/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commercial proof waiver/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Request self-hosting review/i })).toHaveAttribute(
      "href",
      "/request-access?product=openplan&lane=self-hosted&source=pricing&intent=self-hosting-review",
    );
    expect(screen.getByRole("link", { name: /Request managed hosting/i })).toHaveAttribute(
      "href",
      "/request-access?product=openplan&lane=managed-hosting&source=pricing&intent=managed-hosting-review",
    );
    expect(screen.queryByText(/Create Starter account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Create Professional account/i)).not.toBeInTheDocument();
  });
});
