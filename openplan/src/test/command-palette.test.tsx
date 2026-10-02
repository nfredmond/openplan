import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./guided-flow-jsdom-dialog-shim";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CommandPalette } from "@/components/cartographic/command-palette";

/**
 * THE PALETTE IS A MODAL COMBOBOX, NOT A PAINTED OVERLAY.
 *
 * It was a hand-built overlay with `role="dialog"`: focus could leave it, and
 * moving the highlight with the arrow keys changed a background colour and told
 * a screen reader nothing. These tests hold the parts a sighted mouse user never
 * notices are missing.
 *
 * Blind category: jsdom has no top layer and no real focus trap, so this cannot
 * show that focus is held inside the dialog or returned on close. That is the
 * shared `ModalDialog`'s job and needs a browser.
 */
describe("CommandPalette", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders nothing while closed", () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("exposes a listbox owned by the input, and names the highlighted option", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);

    const input = screen.getByRole("combobox", { name: "Jump to a module" });
    const list = screen.getByRole("listbox", { name: "Modules" });
    expect(input.getAttribute("aria-controls")).toBe(list.id);

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(5);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(options[0].getAttribute("aria-selected")).toBe("false");
  });

  it("goes to the highlighted module on Enter and closes", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "grants" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/grants");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when nothing matches, and points at no option", () => {
    render(<CommandPalette open onOpenChange={() => {}} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzz-no-such-module" } });

    expect(screen.getByText("No matching module.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("closes when the dimmed area outside the panel is pressed, not when the panel is", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("listbox"));
    expect(onOpenChange).not.toHaveBeenCalled();

    // A backdrop press lands on the dialog element itself.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
