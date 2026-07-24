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
  it("renders contact as a plain, non-commercial help route", async () => {
    render(await ContactPage({ searchParams: Promise.resolve({ lane: "managed-hosting" }) }));

    expect(
      screen.getByRole("heading", { name: /Questions, bug reports, and feedback/i }),
    ).toBeInTheDocument();
    // The topic selector survives (it sorts messages); its commercial framing does not.
    expect(screen.getByLabelText(/What is this about/i)).toHaveValue("managed_hosting_admin");
    // Nothing on this page may read as a sales motion.
    expect(document.body.textContent).not.toMatch(/managed hosting|pricing|subscription|service lane/i);
  });

});
