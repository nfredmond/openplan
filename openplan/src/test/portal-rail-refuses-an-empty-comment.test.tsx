/**
 * WHAT A RESIDENT IS ALLOWED TO SEND, AND WHAT THEY ARE ALLOWED TO BE TOLD.
 *
 * Two defects found by walking the real portal on 2026-08-13, both of which
 * every existing test of this surface passed:
 *
 *   1. The required comment box is rendered ONLY on the "what" step, so on the
 *      send step the browser's own `required` validation has nothing to fire
 *      on. A resident could walk to the end without typing, press Send, and the
 *      POST went out with `body: ""`.
 *
 *   2. The API answered that POST with its literal English "Invalid
 *      submission", and the rail rendered the server's string directly — on a
 *      surface that may be showing Spanish, Farsi or Hmong to somebody who
 *      reads no English at all.
 *
 * The two are one failure: the second is what the first hands the resident.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet and has no box
 * model. Nothing here is evidence about what is visible, only about what
 * exists, what is sent, and in which language it is worded.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import { PublicMapSidebar } from "@/components/engagement/public-map-sidebar";

/**
 * The catalog through the REAL builder, never a hand-written message map: a
 * fixture that declared its own strings could assert copy the product does not
 * carry, which is the one thing a copy test exists to catch.
 */
function translatorFor(requested: string) {
  const locale = resolvePortalLocale({ requested, acceptLanguage: null });
  return createPortalTranslator(buildPortalMessageBundle(locale));
}

function renderRail(requested = "en") {
  const translator = translatorFor(requested);
  render(
    <PublicMapSidebar
      shareToken="share-token-12345"
      acceptingSubmissions
      categories={[]}
      demographicsEnabled={false}
      translator={translator}
      geometry={null}
      onClearGeometry={() => {}}
      drawMode="point"
      onDrawModeChange={() => {}}
      mapAvailable={false}
    />
  );
  return translator;
}

/** Walk forward the way a resident does, until the step arrives or the rail refuses. */
function pressNext() {
  fireEvent.click(screen.getByRole("button", { name: /^(Next|Siguiente)$/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the guided rail refuses to send an empty comment", () => {
  it("will not walk past the comment step with nothing written, and says why where the box is", () => {
    const translator = renderRail();

    // "where" → "what" is allowed: nothing is required yet.
    pressNext();
    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();

    // "what" → onward is not, while the box is empty.
    pressNext();
    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
    expect(screen.getByTestId("portal-body-needed")).toHaveTextContent(
      translator.t("portal.commentNeeded")
    );

    // And once something is written, the same button moves on.
    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "The signal is too short to cross." },
    });
    expect(screen.queryByTestId("portal-body-needed")).not.toBeInTheDocument();
    pressNext();
    expect(screen.getByTestId("portal-step-extras")).toBeInTheDocument();
  });

  /**
   * THE CHIPS ARE A SECOND WAY FORWARD and were the actual route to the defect:
   * the numbered steps are real buttons so a confident person can jump, and a
   * jump straight to "Send" skipped the only field that matters.
   */
  it("sends a resident who jumps straight to the send step back to the box", () => {
    renderRail();

    fireEvent.click(screen.getByRole("button", { name: /5\s*Send it/ }));

    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-step-send")).not.toBeInTheDocument();
    expect(screen.getByTestId("portal-body-needed")).toBeInTheDocument();
  });

  /**
   * THE ONE THAT MATTERS MOST: no request at all.
   *
   * The step guard is not the whole answer, because a form can be submitted
   * without the Send button — pressing Enter in any single-line field in it does
   * exactly that — so the send path carries its own check. Exercised here by
   * submitting the form directly, which is the same event those keystrokes
   * raise. Whitespace only, because `body.trim()` is the rule and a body of
   * three spaces is the version of this defect a `length > 0` check would ship.
   */
  it("makes no request when the form is submitted with nothing written", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderRail();
    pressNext();
    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "   " },
    });

    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    await waitFor(() => expect(screen.getByTestId("portal-body-needed")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    // And it put the resident on the step that holds the box, not on a dead end.
    expect(screen.getByTestId("portal-step-what")).toBeInTheDocument();
  });
});

describe("a refusal from the agency's own API is worded in the resident's language", () => {
  /**
   * The probe that found this: the API refuses with `{"error":"Invalid
   * submission"}`, and the rail printed that sentence. Asserted in SPANISH
   * because in English the defect is invisible — the server's English and the
   * catalog's English look identical on screen.
   */
  it("shows the catalog's sentence, never the server's English, to a Spanish reader", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          json: async () => ({ error: "Invalid submission" }),
        }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    const translator = renderRail("es");

    pressNext();
    fireEvent.change(document.querySelector("#portal-body") as HTMLTextAreaElement, {
      target: { value: "El semáforo dura muy poco para cruzar." },
    });
    while (!screen.queryByTestId("portal-step-send")) pressNext();
    fireEvent.submit(screen.getByTestId("portal-guided-form"));

    const alert = await screen.findByTestId("portal-submit-error");
    expect(fetchMock).toHaveBeenCalled();

    // The sentence the resident reads is the catalog's, in their language.
    expect(alert).toHaveTextContent(translator.t("portal.submitFailed"));
    expect(translator.t("portal.submitFailed")).not.toBe("Invalid submission");

    /*
      The server's English is NOT thrown away — it is the only clue about why —
      but it lives inside the operator disclosure, closed, rather than being the
      sentence a resident is handed. Asserted by ancestry rather than by absence:
      a test that only checked the string was gone would pass a version that
      deleted the operator's diagnostic too.
    */
    const serverText = screen.getByText("Invalid submission");
    expect(serverText.closest("details")).not.toBeNull();
    expect(serverText.closest("details")?.hasAttribute("open")).toBe(false);
    expect(serverText.getAttribute("lang")).toBe("en");
  });
});
