/**
 * A RESIDENT'S COMMENT MUST NOT GO OUT BEFORE THEY HAVE SEEN IT.
 *
 * WHERE THIS CAME FROM. On 2026-08-15 the nightly browser smoke was found to
 * have failed every run since the day it was created. Fixing the first failure
 * revealed this one: the smoke walked the portal — where, what, extras, you —
 * and then could not find the Send button, because the comment had ALREADY been
 * posted. Four local runs, four rows in `engagement_items`, and in none of them
 * did the person who wrote the comment ever see the review step.
 *
 * THE MECHANISM. "Next" and "Send" were one `<Button>` in one position, so React
 * reused the same DOM node and changed `type` from "button" to "submit" in
 * place. The click that ran `goNext` flushed that re-render inside its own
 * discrete event, and the browser then performed the click's default action
 * against the node's new type. The click that meant "show me the next question"
 * posted the comment instead.
 *
 * WHY THE GUARD IS IN `handleSubmit` AND NOT ONLY ON THE BUTTON. Distinct React
 * keys remove that particular trigger, but a form can be submitted without any
 * button at all: pressing Enter in the name field is implicit submission, free
 * from the browser, and raises exactly the same event. Whatever raises it, a
 * submit from before the review step is not a decision to send.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom decides a button's activation behaviour
 * before React re-renders, so the DOM-reuse race does NOT reproduce here — no
 * test in this file would have caught the original defect. It guards the rule
 * that makes the defect harmless from any direction. The trigger itself is
 * proven in a real browser by
 * `qa-harness/openplan-local-engagement-report-handoff-smoke.js`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function pressNext() {
  fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
}

/** Walk to the "you" step the way a resident does, with something written. */
function walkToYouStep() {
  renderRail();
  pressNext(); // where → what
  fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
    target: { value: "The crossing by the school is too short to get across." },
  });
  pressNext(); // what → extras
  pressNext(); // extras → you
  expect(screen.getByTestId("portal-step-you")).toBeInTheDocument();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a comment must be reviewed before it is sent", () => {
  it("sends nothing when the form is submitted from a step before the review", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    walkToYouStep();
    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    await waitFor(() => {
      expect(screen.getByTestId("portal-step-send")).toBeInTheDocument();
    });
    // The whole finding in one assertion: a written comment, a submit event, and
    // no request. Everything else here is about not making the cure worse.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the resident TO the review step rather than refusing silently", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response));

    walkToYouStep();
    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    // A submit means they are ready. Swallowing it and leaving them on "you"
    // would be a dead button — the same defect wearing the opposite face.
    await waitFor(() => {
      expect(screen.getByTestId("portal-step-send")).toBeInTheDocument();
    });
    expect(screen.getByTestId("portal-review-body")).toHaveTextContent(
      /crossing by the school/i
    );
  });

  it("still sends when the resident submits from the review step", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    walkToYouStep();
    pressNext(); // you → send, the ordinary way
    expect(screen.getByTestId("portal-step-send")).toBeInTheDocument();

    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    // The guard must not have turned the review step into a place you cannot
    // leave — a portal that never sends is worse than one that sends too early.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("does not skip the empty-comment rule on its way to the review step", () => {
    /*
      The two guards compose in one direction only. `goToStep` refuses to pass
      the comment box while it is empty, and an early submit goes THROUGH it
      rather than around it — otherwise this fix would have re-opened the
      2026-08-13 defect where a resident reached the end having written nothing.
    */
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response));

    renderRail();
    pressNext(); // where → what, nothing written
    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-step-send")).not.toBeInTheDocument();
    expect(screen.getByTestId("portal-body-needed")).toBeInTheDocument();
  });
});
