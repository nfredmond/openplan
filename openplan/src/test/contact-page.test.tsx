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

import ContactPage from "@/app/(public)/contact/page";
import OpenPlanFitPage from "@/app/(public)/contact/openplan-fit/page";

describe("contact intake pages", () => {
  it("renders the general contact route as implementation/support intake", async () => {
    render(await ContactPage({ searchParams: Promise.resolve({ lane: "managed-hosting" }) }));

    expect(
      screen.getByRole("heading", {
        name: /Request OpenPlan implementation, support, or managed deployment review/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Which service lane do you need/i)).toHaveValue("managed_hosting_admin");
  });

  it("renders OpenPlan fit review with legacy checkout context prefilled", async () => {
    render(
      await OpenPlanFitPage({
        searchParams: Promise.resolve({
          product: "openplan",
          tier: "openplan-starter",
          checkout: "disabled",
          legacyCheckout: "1",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: /Review OpenPlan implementation and support fit before checkout/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Which service lane do you need/i)).toHaveValue("implementation_onboarding");
    expect(screen.getByLabelText(/First workflow to stand up/i)).toHaveValue("other");
    expect((screen.getByLabelText(/Onboarding needs/i) as HTMLTextAreaElement).value).toContain(
      "Legacy tier/reference: openplan-starter.",
    );
  });
});
