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
    expect(screen.getByText(/Managed hosting \+ support/i)).toBeInTheDocument();
    expect(screen.getByText(/Implementation \+ planning services/i)).toBeInTheDocument();
    expect(screen.getByText(/Stripe remains the payment rail for hosted workspace support and service retainers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/historical live payment.*current non-money-moving billing proof/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/no fresh same-cycle paid canary was run/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Request self-hosting review/i })).toHaveAttribute(
      "href",
      "/request-access?lane=self-hosted",
    );
    expect(screen.getByRole("link", { name: /Request managed hosting/i })).toHaveAttribute(
      "href",
      "/request-access?lane=managed-hosting",
    );
    expect(screen.queryByText(/Create Starter account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Create Professional account/i)).not.toBeInTheDocument();
  });
});
