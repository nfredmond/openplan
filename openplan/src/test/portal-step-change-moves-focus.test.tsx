/**
 * A KEYBOARD RESIDENT KEEPS THEIR PLACE BETWEEN STEPS.
 *
 * Found on 2026-11-14 by an agent sending a comment with the keyboard only at
 * 390 px on a local build. After "Next", focus stayed on the button, so the new
 * step's field sat behind it in the tab order, and nothing announced the step.
 * Moving from "About you" to "Send it" swaps the Next button for the Send
 * button, so focus fell to <body> and the resident had to tab through the whole
 * map toolbar again to find Send.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom has no screen reader and no focus ring.
 * It shows which element holds focus, not that anyone hears or sees it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { PublicMapSidebar } from "@/components/engagement/public-map-sidebar";

function renderRail() {
  const locale = resolvePortalLocale({ requested: "en", acceptLanguage: null });
  render(
    <PublicMapSidebar
      shareToken="share-token-12345"
      acceptingSubmissions
      categories={[]}
      demographicsEnabled={false}
      translator={createPortalTranslator(buildPortalMessageBundle(locale))}
      geometry={null}
      onClearGeometry={() => {}}
      drawMode="point"
      onDrawModeChange={() => {}}
      mapAvailable={false}
    />
  );
}

/** Press a button the way a keyboard does: it holds focus when it is activated. */
function press(name: RegExp) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

function stepHeading(step: string) {
  return screen.getByTestId(`portal-step-${step}`).querySelector("h2");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("moving between portal steps", () => {
  it("leaves focus alone when the page first opens", () => {
    renderRail();
    expect(document.activeElement).toBe(document.body);
  });

  it("puts focus on each new step's heading, including the step where Next becomes Send", () => {
    renderRail();

    press(/^Next$/);
    expect(document.activeElement).toBe(stepHeading("what"));

    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "The signal is too short to cross." },
    });
    for (const step of ["extras", "you", "send"]) {
      press(/^Next$/);
      expect(document.activeElement).toBe(stepHeading(step));
    }
    // The step that swaps the button is the one that dropped focus to <body>.
    expect(document.activeElement).not.toBe(document.body);

    press(/^Back$/);
    expect(document.activeElement).toBe(stepHeading("you"));
  });

  it("still puts a resident sent back for an empty comment on the comment box", () => {
    renderRail();
    press(/5\.\s*Send it/);
    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.querySelector("#portal-body"));
  });
});
