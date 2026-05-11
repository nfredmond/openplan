import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import PublicLandingPage from "@/app/(public)/page";

describe("PublicLandingPage", () => {
  it("prioritizes request access, keeps sign-in secondary, and shows source/license proof near the Apache claim", () => {
    render(<PublicLandingPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source planning software that keeps maps, engagement, and delivery in one record/i,
      }),
    ).toBeInTheDocument();

    const actions = screen.getAllByRole("link", { name: /Request access/i });
    expect(actions[0]).toHaveAttribute("href", "/request-access");
    expect(actions[0]).toHaveClass("public-primary-link");
    expect(screen.getByRole("link", { name: /Sign in to existing workspace/i })).toHaveClass("public-secondary-link");

    const proofPath = screen.getByLabelText(/Open-source proof path/i);
    expect(within(proofPath).getByText(/Proof path for the Apache-2.0 claim/i)).toBeInTheDocument();
    expect(within(proofPath).getByRole("link", { name: /Source repository/i })).toHaveAttribute(
      "href",
      "https://github.com/nfredmond/openplan",
    );
    expect(within(proofPath).getByRole("link", { name: /Apache-2.0 license text/i })).toHaveAttribute(
      "href",
      "https://github.com/nfredmond/openplan/blob/main/LICENSE",
    );
  });

  it("does not expose gated app routes as public previews", () => {
    render(<PublicLandingPage />);

    expect(screen.queryByRole("link", { name: /^Analysis Studio preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Engagement workspace$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Request the gated map and scenario workspace/i })).toHaveAttribute(
      "href",
      "/request-access?workflow=modeling&source=landing",
    );
    expect(screen.getByRole("link", { name: /Request the gated engagement workspace/i })).toHaveAttribute(
      "href",
      "/request-access?workflow=engagement&source=landing",
    );
  });

  it("does not render a nested main landmark inside the public layout main", () => {
    const { container } = render(<PublicLandingPage />);

    expect(container.querySelector("main")).toBeNull();
  });
});
