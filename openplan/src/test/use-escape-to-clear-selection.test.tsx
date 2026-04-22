import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEscapeToClearSelection } from "@/components/cartographic/use-escape-to-clear-selection";

function fireEscape(target: EventTarget | null = document.body) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  if (target) {
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
}

describe("useEscapeToClearSelection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fires onClear when Escape is pressed and focus is on the body", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: true, onClear }));

    act(() => {
      fireEscape();
    });

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not fire when enabled is false (no active selection)", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: false, onClear }));

    act(() => {
      fireEscape();
    });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("ignores Escape while focus is in an INPUT so native behavior wins", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: true, onClear }));

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      fireEscape(input);
    });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("ignores Escape while focus is in a TEXTAREA", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: true, onClear }));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    act(() => {
      fireEscape(textarea);
    });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("ignores Escape while focus is on a contenteditable node", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: true, onClear }));

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);

    act(() => {
      fireEscape(editable);
    });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keys", () => {
    const onClear = vi.fn();
    renderHook(() => useEscapeToClearSelection({ enabled: true, onClear }));

    act(() => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      document.body.dispatchEvent(event);
    });

    expect(onClear).not.toHaveBeenCalled();
  });

  it("detaches the listener on unmount", () => {
    const onClear = vi.fn();
    const { unmount } = renderHook(() =>
      useEscapeToClearSelection({ enabled: true, onClear }),
    );

    unmount();

    act(() => {
      fireEscape();
    });

    expect(onClear).not.toHaveBeenCalled();
  });
});
