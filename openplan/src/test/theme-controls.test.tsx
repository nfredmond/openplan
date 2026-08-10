import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeControls } from "@/components/theme-controls";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Appearance is TWO independent choices, and the bug to prevent is coupling.
 *
 * Light/dark is the mode; the palette is the colour family. Each palette
 * supplies both modes, so switching mode must never discard the palette and
 * switching palette must never flip the mode. Written as one setting — the
 * obvious shortcut, since both live on `<html>` — "Slate" would mean a third
 * theme rather than slate-in-whichever-light-you-are-working-in.
 */
function renderControls() {
  return render(
    <ThemeProvider defaultTheme="dark">
      <ThemeControls />
    </ThemeProvider>
  );
}

const root = () => document.documentElement;

describe("ThemeControls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    root().className = "";
    root().removeAttribute("data-palette");
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("offers light and dark as two named options, not one unlabelled glyph", async () => {
    renderControls();

    /*
     * The control this replaced was a lone 14px sun/moon hidden in a
     * hover-expanding rail: one button, no name, and no way to tell the current
     * mode from the action. Both of those are what this asserts, and neither
     * depends on the visible words — which came off so the header's search pill
     * would stop being pushed underneath this control.
     *
     * What must hold: TWO options, each with an accessible name a screen reader
     * and a tooltip can both use.
     */
    expect(await screen.findByRole("button", { name: "Light mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark mode" })).toBeInTheDocument();
    expect(screen.getByTestId("theme-mode-light")).toHaveAccessibleName("Light mode");
    expect(screen.getByTestId("theme-mode-dark")).toHaveAccessibleName("Dark mode");
  });

  /**
   * The two appearance controls sit side by side in the header and must read as
   * one pair.
   *
   * They did not. The palette pill rendered 10px shorter than the mode switch
   * beside it (27.4px against 37.3px, measured in the browser) because it was
   * built differently: one padded element carrying its own border, where the
   * switch is a padded box AROUND a padded button. Reported 2026-08-10.
   *
   * jsdom computes no layout, so this cannot assert a height. What it can
   * assert is the thing that CAUSED the mismatch — the two shells are built the
   * same way. Tuning a padding value until the pixels agreed would have left
   * nothing for a test to hold on to, and the next change to either control
   * would have pulled them apart again.
   */
  it("gives the palette pill the same shell as the mode switch", async () => {
    renderControls();

    const modeShell = (await screen.findByRole("group", { name: "Colour mode" })).className;
    const paletteShell = screen.getByTestId("theme-palette-trigger").parentElement?.className ?? "";

    for (const shellClass of ["rounded-xl", "border", "border-border/70", "bg-background/70", "p-1"]) {
      expect(modeShell, `mode switch shell lost ${shellClass}`).toContain(shellClass);
      expect(paletteShell, `palette pill shell is missing ${shellClass}`).toContain(shellClass);
    }

    // ...and the inner buttons carry the same inset and icon box, which is what
    // makes the two shells resolve to the same height.
    for (const testId of ["theme-mode-light", "theme-mode-dark", "theme-palette-trigger"]) {
      const button = screen.getByTestId(testId);
      expect(button.className, `${testId} inset`).toContain("px-2.5");
      expect(button.className, `${testId} inset`).toContain("py-1.5");
      for (const icon of button.querySelectorAll("svg, span[aria-hidden='true']")) {
        expect(icon.getAttribute("class") ?? "", `${testId} icon box`).toContain("h-4 w-4");
      }
    }
  });

  it("marks the current mode rather than the action", async () => {
    renderControls();

    const dark = await screen.findByTestId("theme-mode-dark");
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("theme-mode-light")).toHaveAttribute("aria-pressed", "false");
  });

  it("applies and persists the mode", async () => {
    renderControls();

    fireEvent.click(await screen.findByTestId("theme-mode-light"));

    await waitFor(() => expect(root().classList.contains("light")).toBe(true));
    expect(root().classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("applies and persists the palette as an attribute", async () => {
    renderControls();

    fireEvent.click(await screen.findByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByTestId("theme-palette-slate"));

    await waitFor(() => expect(root().getAttribute("data-palette")).toBe("slate"));
    expect(window.localStorage.getItem("theme-palette")).toBe("slate");
  });

  /** The coupling bug, from both directions. */
  it("keeps the palette when the mode changes", async () => {
    renderControls();

    fireEvent.click(await screen.findByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByTestId("theme-palette-meadow"));
    await waitFor(() => expect(root().getAttribute("data-palette")).toBe("meadow"));

    fireEvent.click(screen.getByTestId("theme-mode-light"));

    await waitFor(() => expect(root().classList.contains("light")).toBe(true));
    expect(root().getAttribute("data-palette")).toBe("meadow");
    expect(window.localStorage.getItem("theme-palette")).toBe("meadow");
  });

  it("keeps the mode when the palette changes", async () => {
    renderControls();

    fireEvent.click(await screen.findByTestId("theme-mode-light"));
    await waitFor(() => expect(root().classList.contains("light")).toBe(true));

    fireEvent.click(screen.getByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByTestId("theme-palette-harbor"));

    await waitFor(() => expect(root().getAttribute("data-palette")).toBe("harbor"));
    expect(root().classList.contains("light")).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("restores a stored palette on load", async () => {
    window.localStorage.setItem("theme-palette", "plum");

    renderControls();

    await waitFor(() => expect(root().getAttribute("data-palette")).toBe("plum"));
  });

  /**
   * A hand-edited or stale storage entry must not reach `data-palette`. No rule
   * matches an unknown id, so every seed token silently falls back to `:root` —
   * the product looks like the default while claiming to be something else.
   */
  it("ignores a stored palette that no longer exists", async () => {
    window.localStorage.setItem("theme-palette", "vaporwave");

    renderControls();

    await waitFor(() => expect(root().getAttribute("data-palette")).toBe("cartographic"));
  });
});
