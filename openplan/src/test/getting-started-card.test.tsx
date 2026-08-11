import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { GettingStartedCard } from "@/components/onboarding/getting-started-card";

const KEY = "openplan:getting-started-dismissed:user-1:workspace-1";

function renderCard(dismissible: boolean) {
  return render(
    <GettingStartedCard userId="user-1" workspaceId="workspace-1" dismissible={dismissible}>
      <div data-testid="checklist-content" />
    </GettingStartedCard>
  );
}

describe("GettingStartedCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the checklist by default, with a way to hide it", () => {
    renderCard(true);

    expect(screen.getByTestId("checklist-content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide this checklist/ })).toBeInTheDocument();
  });

  it("hides on dismiss, persists the choice, and leaves a permanent way back", () => {
    renderCard(true);

    fireEvent.click(screen.getByRole("button", { name: /Hide this checklist/ }));

    expect(screen.queryByTestId("checklist-content")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("1");

    // The re-entry link is right there, and it works.
    fireEvent.click(screen.getByRole("button", { name: /Getting started/ }));
    expect(screen.getByTestId("checklist-content")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("honors a dismissal stored on a previous visit", () => {
    window.localStorage.setItem(KEY, "1");
    renderCard(true);

    expect(screen.queryByTestId("checklist-content")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Getting started/ })).toBeInTheDocument();
  });

  it("cannot be dismissed while the home geography is unset, even with a stored dismissal", () => {
    // The card is the thing telling the workspace it does not know where it
    // is; hiding that message would recreate the silent emptiness it exists
    // to prevent.
    window.localStorage.setItem(KEY, "1");
    renderCard(false);

    expect(screen.getByTestId("checklist-content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hide this checklist/ })).not.toBeInTheDocument();
  });

  it("scopes the stored dismissal to the user and workspace", () => {
    window.localStorage.setItem("openplan:getting-started-dismissed:user-2:workspace-1", "1");
    renderCard(true);

    // Someone else's dismissal is not this user's.
    expect(screen.getByTestId("checklist-content")).toBeInTheDocument();
  });
});
