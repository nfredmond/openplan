import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { ThemeControls } from "@/components/theme-controls";
import { ThemeProvider } from "@/components/theme-provider";

/*
  THE DEFAULT FOLLOWS THE DEVICE (decision D3, October 1, 2026; built October
  10). OpenPlan used to open dark for everyone. Now a reader with no stored
  choice sees what their operating system is set to, a stored "light" or
  "dark" is kept, and "Match this device" returns to following it.
*/
const root = () => document.documentElement;

function stubDeviceScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    flip(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderControls() {
  return render(
    <ThemeProvider defaultTheme="system">
      <ThemeControls />
    </ThemeProvider>
  );
}

describe("theme follows the device", () => {
  beforeEach(() => {
    window.localStorage.clear();
    root().className = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("uses the device's dark setting when nothing is stored, and follows a change", async () => {
    const device = stubDeviceScheme(true);
    renderControls();

    await waitFor(() => expect(root().classList.contains("dark")).toBe(true));
    expect(await screen.findByTestId("theme-mode-system")).toHaveAttribute("aria-pressed", "true");

    device.flip(false);
    await waitFor(() => expect(root().classList.contains("light")).toBe(true));
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("keeps a stored choice over the device setting", async () => {
    stubDeviceScheme(true);
    window.localStorage.setItem("theme", "light");
    renderControls();

    await waitFor(() => expect(root().classList.contains("light")).toBe(true));
    expect(await screen.findByTestId("theme-mode-light")).toHaveAttribute("aria-pressed", "true");
  });

  it("forgets the stored choice when the reader picks Match this device", async () => {
    stubDeviceScheme(false);
    window.localStorage.setItem("theme", "dark");
    renderControls();

    fireEvent.click(await screen.findByRole("button", { name: "Match this device" }));

    await waitFor(() => expect(root().classList.contains("light")).toBe(true));
    expect(window.localStorage.getItem("theme")).toBeNull();
  });

  it("ships no hard-coded dark class and resolves the device before first paint", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const htmlClass = layout.match(/<html[\s\S]*?className=\{`([^`]*)`\}/)?.[1] ?? "";
    expect(htmlClass).not.toMatch(/\bdark\b/);
    expect(layout).toContain('matchMedia("(prefers-color-scheme: dark)")');
    expect(layout).toContain('<ThemeProvider defaultTheme="system">');
  });
});
