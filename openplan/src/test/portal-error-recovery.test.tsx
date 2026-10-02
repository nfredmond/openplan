import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PortalError from "@/app/(portal)/error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public portal error recovery", () => {
  it("offers a reload without asserting a submission receipt or failure cause", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const reload = vi.fn();
    const browserWindow = window;
    // Keep the real DOM and event dispatch. Intercept only browser navigation,
    // which jsdom cannot execute, so a reset-only handler cannot satisfy this check.
    vi.stubGlobal("window", new Proxy(browserWindow, {
      get(target, property, receiver) {
        return property === "location" ? { reload } : Reflect.get(target, property, receiver);
      },
    }));
    render(<PortalError error={new Error("Synthetic unknown outcome")} reset={reset} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This page did not load.");
    expect(alert).toHaveTextContent("Please try loading this page again in a moment.");
    expect(alert).not.toHaveTextContent(/was received|on our side|not with your phone/i);
    expect(reset).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });
});
