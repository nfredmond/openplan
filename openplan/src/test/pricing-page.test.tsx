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
  it("keeps pricing language aligned to explicit account creation and workspace billing selection", () => {
    render(<PricingPage />);

    expect(screen.getByRole("heading", { name: /OpenPlan Early Access Pricing/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create Starter account/i })).toHaveAttribute("href", "/sign-up?plan=starter");
    expect(screen.getByRole("link", { name: /Create Professional account/i })).toHaveAttribute("href", "/sign-up?plan=professional");
    expect(screen.getByText(/Checkout starts only after account creation, sign-in, and explicit workspace billing selection/i)).toBeInTheDocument();
    expect(screen.queryByText(/Stripe checkout wiring is in progress/i)).not.toBeInTheDocument();
  });
});
