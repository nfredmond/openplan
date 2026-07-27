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
  it("positions examples as open-source proof anyone can verify, not a sales path", () => {
    render(<ExamplesEvidenceCatalogPage />);

    expect(
      screen.getByRole("heading", {
        name: /Open-source proof you can verify yourself/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Inspect the proof trail/i)).toBeInTheDocument();
    expect(screen.getByText(/Run it yourself/i)).toBeInTheDocument();
    expect(screen.getByText(/One example is not a guarantee/i)).toBeInTheDocument();
    expect(screen.getByText(/One completed run, verbatim/i)).toBeInTheDocument();
    expect(screen.getAllByText(/internal prototype only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/237\.62%/i).length).toBeGreaterThan(0);

    expect(screen.getByRole("link", { name: "Create your free workspace" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    for (const link of screen.getAllByRole("link", { name: /Ask a question/i })) {
      expect(link).toHaveAttribute("href", "/contact");
    }
  });

  it("carries no sales-era framing and never links a public visitor into the authed app shell", () => {
    render(<ExamplesEvidenceCatalogPage />);

    // The commercial-era copy this page used to carry. None of it may return.
    expect(document.body).not.toHaveTextContent(/buyer/i);
    expect(document.body).not.toHaveTextContent(/supervised/i);
    expect(document.body).not.toHaveTextContent(/service[- ]lane/i);
    expect(document.body).not.toHaveTextContent(/paid help/i);
    expect(document.body).not.toHaveTextContent(/vendor promise/i);
    expect(document.body).not.toHaveTextContent(/Command Center/i);
    expect(document.body).not.toHaveTextContent(/Guided demo/i);

    // Overclaim boundaries that predate the sales cleanup still hold.
    expect(document.body).not.toHaveTextContent(/validated forecast/i);
    expect(document.body).not.toHaveTextContent(/live run/i);

    // No link into an auth-gated route from a public page.
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toMatch(/^\/command-center/);
    }
  });
});
