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

import RequestAccessPage from "@/app/(public)/request-access/page";

describe("RequestAccessPage", () => {
  it("renders the supervised access intake surface without auto-provisioning language", () => {
    render(<RequestAccessPage />);

    expect(screen.getByRole("heading", { name: /Start a supervised OpenPlan workspace review/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open request form/i })).toHaveAttribute("href", "#request-access-form");
    expect(screen.getByLabelText(/Agency or organization/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/What should OpenPlan help with first/i)).toBeInTheDocument();
    expect(screen.getByText(/does not create an account, workspace, or subscription/i)).toBeInTheDocument();
    expect(screen.queryByText(/workspace will be created automatically/i)).not.toBeInTheDocument();
  });
});
