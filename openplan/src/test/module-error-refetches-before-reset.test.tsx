import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";

/**
 * "TRY AGAIN" MUST ASK THE SERVER AGAIN.
 *
 * Sixteen of seventeen error boundaries called only `reset()`, which
 * re-renders the boundary from what the client already holds. After a server
 * component failure that is the failed response, so the button showed the
 * same error. They also said "Nothing has been deleted", which an error page
 * cannot know. (KI-2026-10-12-027.)
 *
 * Blind spots, stated: jsdom has no server, so this proves the order of the
 * calls, not that a fresh response arrives. The wiring check covers the
 * boundaries listed below; a new module's error page is not found by itself.
 */

const refreshMock = vi.fn<() => void>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn<(href: string) => void>() }),
}));

import { ModuleError } from "@/components/ui/module-error";
import AerialError from "@/app/(app)/aerial/error";
import EngagementError from "@/app/(app)/engagement/error";
import AppError from "@/app/(app)/error";
import GrantsError from "@/app/(app)/grants/error";
import MapsError from "@/app/(app)/maps/error";
import ModelsError from "@/app/(app)/models/error";
import PlansError from "@/app/(app)/plans/error";
import ProgramsError from "@/app/(app)/programs/error";
import ProjectsError from "@/app/(app)/projects/error";
import ReportsError from "@/app/(app)/reports/error";
import RtpError from "@/app/(app)/rtp/error";
import ScenariosError from "@/app/(app)/scenarios/error";
import PublicError from "@/app/(public)/error";
import PublishedError from "@/app/(published)/error";
import RootError from "@/app/error";

type Boundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

/** Each boundary, the heading it must show, and where "back" leads. */
const BOUNDARIES: Array<[string, Boundary, string, string | null]> = [
  ["aerial", AerialError, "Aerial Imagery did not load.", "/aerial"],
  ["engagement", EngagementError, "Engagement did not load.", "/engagement"],
  ["app", AppError, "This page did not load.", "/dashboard"],
  ["grants", GrantsError, "Grants did not load.", "/grants"],
  ["maps", MapsError, "Maps did not load.", "/maps"],
  ["models", ModelsError, "Models did not load.", "/models"],
  ["plans", PlansError, "Plans did not load.", "/plans"],
  ["programs", ProgramsError, "Programming Cycles did not load.", "/programs"],
  ["projects", ProjectsError, "Projects did not load.", "/projects"],
  ["reports", ReportsError, "Reports did not load.", "/reports"],
  ["rtp", RtpError, "Regional Plan (RTP) did not load.", "/rtp"],
  ["scenarios", ScenariosError, "Scenarios did not load.", "/scenarios"],
  ["public", PublicError, "This page did not load.", "/"],
  ["published", PublishedError, "This page did not load.", null],
  ["root", RootError, "This page did not load.", "/dashboard"],
];

/** Things an error page cannot know, said as if it did. */
const UNVERIFIABLE_REASSURANCE = /nothing has been deleted|nothing was (lost|deleted)|has been saved|on our side|not with your phone|withdrew/i;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

describe("ModuleError", () => {
  it("refreshes the route before resetting the boundary", async () => {
    const reset = vi.fn<() => void>();
    render(
      <ModuleError
        error={new Error("synthetic server component failure")}
        reset={reset}
        moduleName="Grants"
        backHref="/grants"
        backLabel="Back to Grants"
        logTag="grants-error"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });

  it("says the page did not load and nothing it cannot know, with focus on the heading", () => {
    const error: Error & { digest?: string } = Object.assign(new Error("synthetic"), { digest: "d1g3st" });
    render(
      <ModuleError
        error={error}
        reset={vi.fn<() => void>()}
        moduleName="Grants"
        backHref="/grants"
        backLabel="Back to Grants"
        logTag="grants-error"
      />
    );

    const alert = screen.getByRole("alert");
    const heading = screen.getByRole("heading", { level: 1, name: "Grants did not load." });
    expect(alert).toContainElement(heading);
    expect(document.activeElement).toBe(heading);
    expect(alert).not.toHaveTextContent(UNVERIFIABLE_REASSURANCE);
    // The reference is kept for whoever runs the deployment, folded away.
    expect(screen.getByText("Reference d1g3st").closest("details")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Back to Grants" })).toHaveAttribute("href", "/grants");
  });
});

describe("every error boundary refetches before it resets", () => {
  for (const [name, Boundary, heading, backHref] of BOUNDARIES) {
    it(`${name}: names its page, asks the server again, then resets`, async () => {
      const reset = vi.fn<() => void>();
      render(<Boundary error={new Error(`synthetic ${name} failure`)} reset={reset} />);

      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByRole("alert")).not.toHaveTextContent(UNVERIFIABLE_REASSURANCE);
      if (backHref) {
        expect(screen.getByRole("link", { name: /back|home/i })).toHaveAttribute("href", backHref);
      }

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      });

      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledTimes(1);
      expect(refreshMock.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
    });
  }
});

describe("the root layout's own boundary", () => {
  it("reloads the document, since the app shell itself failed", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const reload = vi.fn<() => void>();
    const browserWindow = window;
    vi.stubGlobal(
      "window",
      new Proxy(browserWindow, {
        get(target, property, receiver) {
          return property === "location" ? { reload } : Reflect.get(target, property, receiver);
        },
      })
    );
    const reset = vi.fn<() => void>();
    try {
      render(<GlobalError error={new Error("synthetic root layout failure")} reset={reset} />);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
