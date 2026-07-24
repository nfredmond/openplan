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
  it("leads with self-serve sign-up, keeps sign-in secondary, and shows source/license proof near the Apache claim", () => {
    render(<PublicLandingPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source planning software that keeps maps, engagement, and delivery in one record/i,
      }),
    ).toBeInTheDocument();

    // Posture flip: the primary CTA is a free self-serve sign-up, not a
    // founder access queue.
    const primary = screen.getByRole("link", { name: /Create your free workspace/i });
    expect(primary).toHaveAttribute("href", "/sign-up?source=landing");
    expect(primary).toHaveClass("public-primary-link");
    expect(screen.queryByRole("link", { name: /^Request access$/i })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Getting started/i)).toBeInTheDocument();
    expect(screen.queryByText(/Current motion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dashboard theater/i)).not.toBeInTheDocument();
  });

  it("does not expose gated app routes as public previews", () => {
    render(<PublicLandingPage />);

    expect(screen.queryByRole("link", { name: /^Analysis Studio preview$/i })).not.toBeInTheDocument();
    // The workspace surfaces now route to self-serve sign-up, not a request
    // queue, and carry the signed-in-workspace framing honestly.
    expect(screen.getByRole("link", { name: /Open the map and scenario workspace/i })).toHaveAttribute(
      "href",
      "/sign-up?source=landing&intent=modeling",
    );
    expect(screen.getByRole("link", { name: /Open the engagement workspace/i })).toHaveAttribute(
      "href",
      "/sign-up?source=landing&intent=engagement",
    );
    expect(screen.queryByText(/operator surface/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/operator review/i)).not.toBeInTheDocument();
  });

  it("does not render a nested main landmark inside the public layout main", () => {
    const { container } = render(<PublicLandingPage />);

    expect(container.querySelector("main")).toBeNull();
  });
});
