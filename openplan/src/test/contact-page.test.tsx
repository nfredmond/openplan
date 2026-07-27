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

describe("contact page", () => {
  it("renders contact as a plain, non-commercial help route with no intake form", () => {
    render(<ContactPage />);

    expect(
      screen.getByRole("heading", { name: /Questions, bug reports, and feedback/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This is not a way to get access/i)).toBeInTheDocument();

    // The access-request letterbox is gone: no form fields of any kind.
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("input, textarea, select")).toBeNull();

    // The repository is the front door.
    const issueLinks = screen.getAllByRole("link", { name: /issue/i });
    expect(issueLinks.length).toBeGreaterThan(0);
    for (const link of issueLinks) {
      expect(link.getAttribute("href")).toContain("github.com/nfredmond/openplan");
    }

    // Nothing on this page may read as a sales motion or an access queue.
    expect(document.body.textContent).not.toMatch(
      /managed hosting|pricing|subscription|service lane|request access|access queue approval/i,
    );
  });
});
