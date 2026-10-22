import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupAdvancedGroup } from "@/components/engagement/setup-advanced-group";

/**
 * THE ADVANCED GROUP IS CLOSED, AND A LINK INTO IT STILL ARRIVES.
 *
 * The campaign Setup tab collapses everything a first public page does not
 * need. The rest of the product links into that content by anchor
 * (`#public-share-controls` from the live checklist and the header link block,
 * `#campaign-control-title`, a context layer's row), and a fragment that points
 * into a closed disclosure scrolls to nothing. These pin both halves: closed
 * by default, open when the fragment names something inside, and untouched
 * when it names something elsewhere.
 */

function renderGroup() {
  return render(
    <>
      <p id="outside-the-group">Before publishing</p>
      <SetupAdvancedGroup summary="Map layers and settings.">
        <p id="public-share-controls">Public access</p>
      </SetupAdvancedGroup>
    </>
  );
}

function setHash(hash: string) {
  window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
}

describe("SetupAdvancedGroup", () => {
  afterEach(() => setHash(""));

  it("starts closed, with its contents in the page but not shown", () => {
    renderGroup();

    const group = screen.getByTestId("setup-advanced");
    expect(group).not.toHaveAttribute("open");
    expect(screen.getByText("Public access")).not.toBeVisible();
    expect(screen.getByText("Map layers and settings.")).toBeVisible();
  });

  it("opens on arrival when the fragment names something inside it", () => {
    setHash("public-share-controls");
    renderGroup();

    expect(screen.getByTestId("setup-advanced")).toHaveAttribute("open");
    expect(screen.getByText("Public access")).toBeVisible();
  });

  it("stays closed when the fragment names something outside it", () => {
    setHash("outside-the-group");
    renderGroup();

    expect(screen.getByTestId("setup-advanced")).not.toHaveAttribute("open");
  });

  it("opens when an in-page link changes the fragment later", () => {
    renderGroup();
    expect(screen.getByTestId("setup-advanced")).not.toHaveAttribute("open");

    act(() => {
      setHash("public-share-controls");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(screen.getByTestId("setup-advanced")).toHaveAttribute("open");
  });
});
