import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeControls } from "@/components/theme-controls";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { APPEARANCE_SCRIPT, normalizeCorners } from "@/lib/theme/appearance";

const root = () => document.documentElement;
const controls = () => <ThemeProvider><ThemeControls /></ThemeProvider>;
const prepaint = () => new Function(APPEARANCE_SCRIPT)();

function CornerReadout() {
  const { corners } = useTheme();
  return <span>{corners}</span>;
}

beforeEach(() => {
  localStorage.clear();
  root().className = "";
  root().removeAttribute("data-palette");
  root().removeAttribute("data-corners");
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("independent appearance preferences", () => {
  it("keeps defaults and validates unknown corner values", async () => {
    expect(normalizeCorners("square")).toBe("square");
    for (const value of [null, undefined, "round", "SQUARE", ""]) {
      expect(normalizeCorners(value)).toBe("rounded");
    }
    localStorage.setItem("theme-corners", "triangle");
    render(controls());
    await waitFor(() => expect(root()).toHaveAttribute("data-corners", "rounded"));
    expect(root()).toHaveAttribute("data-palette", "cartographic");
    expect(root()).toHaveClass("dark");
  });

  it("selects Signal and Square independently, persists and restores all choices", async () => {
    const view = render(controls());
    fireEvent.click(await screen.findByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Square" }));
    expect(screen.getByRole("button", { name: "Square" })).toHaveAttribute("aria-pressed", "true");
    expect(root()).toHaveAttribute("data-corners", "square");
    expect(localStorage.getItem("theme-corners")).toBe("square");
    fireEvent.click(screen.getByRole("option", { name: /Signal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Light mode" }));
    expect(root()).toHaveAttribute("data-palette", "signal");
    expect(root()).toHaveAttribute("data-corners", "square");
    expect(root()).toHaveClass("light");
    expect(localStorage.getItem("theme-palette")).toBe("signal");
    expect(localStorage.getItem("theme")).toBe("light");
    view.unmount();
    root().removeAttribute("data-corners");
    render(controls());
    await waitFor(() => expect(root()).toHaveAttribute("data-corners", "square"));
    expect(root()).toHaveAttribute("data-palette", "signal");
    expect(root()).toHaveClass("light");
    fireEvent.click(screen.getByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Rounded" }));
    expect(root()).toHaveAttribute("data-corners", "rounded");
    expect(root()).toHaveAttribute("data-palette", "signal");
    expect(root()).toHaveClass("light");
  });

  it("follows cross-tab changes, deletion and clear without coupling choices", async () => {
    localStorage.setItem("theme-palette", "plum");
    render(controls());
    await waitFor(() => expect(root()).toHaveAttribute("data-palette", "plum"));
    const send = (key: string | null, newValue: string | null) => act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
    });
    send("theme-corners", "square");
    expect(root()).toHaveAttribute("data-corners", "square");
    expect(root()).toHaveAttribute("data-palette", "plum");
    send("theme-palette", "signal");
    send("theme", "light");
    expect(root()).toHaveAttribute("data-corners", "square");
    expect(root()).toHaveAttribute("data-palette", "signal");
    expect(root()).toHaveClass("light");
    send("theme-corners", "invalid");
    expect(root()).toHaveAttribute("data-corners", "rounded");
    send("theme-corners", "square");
    send("theme-corners", null);
    expect(root()).toHaveAttribute("data-corners", "rounded");
    send("theme-corners", "square");
    send(null, null);
    expect(root()).toHaveAttribute("data-corners", "rounded");
    expect(root()).toHaveAttribute("data-palette", "cartographic");
    expect(root()).toHaveClass("dark");
  });

  it("allows current-page choices when storage reads and writes are blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    prepaint();
    expect(root()).toHaveClass("dark");
    expect(root()).toHaveAttribute("data-corners", "rounded");
    render(controls());
    fireEvent.click(await screen.findByTestId("theme-palette-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Square" }));
    fireEvent.click(screen.getByRole("option", { name: /Signal/ }));
    expect(root()).toHaveAttribute("data-corners", "square");
    expect(root()).toHaveAttribute("data-palette", "signal");
  });

  it("offers keyboard palette navigation and returns focus on selection and Escape", async () => {
    render(controls());
    const trigger = await screen.findByTestId("theme-palette-trigger");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("dialog", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cartographic/ })).toHaveFocus();
    const list = screen.getByRole("listbox", { name: "Colour palette" });
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("option", { name: /Signal/ })).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Cartographic/ })).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("option", { name: /Signal/ }));
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("appearance before paint and hydration", () => {
  it("applies saved choices before React and rejects stale values", () => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("theme-palette", "signal");
    localStorage.setItem("theme-corners", "square");
    prepaint();
    expect(root()).toHaveClass("light");
    expect(root()).toHaveAttribute("data-palette", "signal");
    expect(root()).toHaveAttribute("data-corners", "square");
    localStorage.setItem("theme-palette", "unknown");
    localStorage.setItem("theme-corners", "unknown");
    prepaint();
    expect(root()).toHaveAttribute("data-palette", "cartographic");
    expect(root()).toHaveAttribute("data-corners", "rounded");
  });

  it("hydrates matching server markup without overwriting prepaint Square with Rounded", async () => {
    localStorage.setItem("theme-corners", "square");
    prepaint();
    const content = <ThemeProvider><CornerReadout /></ThemeProvider>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(content);
    expect(container.textContent).toBe("rounded");
    const setAttribute = vi.spyOn(root(), "setAttribute");
    const onRecoverableError = vi.fn();
    const hydrated = hydrateRoot(container, content, { onRecoverableError });
    await waitFor(() => expect(container.textContent).toBe("square"));
    expect(onRecoverableError).not.toHaveBeenCalled();
    const writes = setAttribute.mock.calls.filter(([key]) => key === "data-corners").map(([, value]) => value);
    expect(writes).toEqual(["square"]);
    act(() => hydrated.unmount());
  });
});
