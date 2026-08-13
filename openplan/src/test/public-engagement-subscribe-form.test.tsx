/**
 * THE EMAIL BOX THAT HAD NO NAME.
 *
 * `PublicSubscribeForm` is the offer to hear what happens next, at the bottom of
 * the context page. Until 2026-08-13 its only field was a bare
 * `<Input type="email">` with a placeholder and nothing else — no `<label>`, no
 * `aria-label`, no `aria-labelledby`. A placeholder is not an accessible name:
 * it is announced inconsistently, it vanishes on the first keystroke, and what a
 * blind resident actually heard at this control was "edit text". The existing
 * `public-engagement-map-loses-nothing.test.tsx` had to find this field by its
 * input TYPE for that reason, and said so in a comment.
 *
 * Every string on the form was also an English literal on a surface that
 * declares the resident's language on its own wrapper.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet and has no box model,
 * so nothing here says the label is visible, legible, or above the box rather
 * than behind it. It proves the accessibility tree and the copy — the two halves
 * that regress in silence.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PublicSubscribeForm } from "@/components/engagement/public-subscribe-form";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle, EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

const translatorFor = (locale: string) =>
  createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: locale, acceptLanguage: null })));

afterEach(cleanup);

describe("the email updates form", () => {
  /**
   * `getByLabelText` resolves through the accessibility tree — a `<label for>`,
   * an `aria-label` or an `aria-labelledby`. A placeholder does not satisfy it,
   * which is exactly why this assertion is the right shape for this defect.
   */
  it("gives the email box a real accessible name, not a placeholder", () => {
    render(<PublicSubscribeForm shareToken="share-token-12345" translator={translatorFor("en")} />);

    const field = screen.getByLabelText(EN_PORTAL_MESSAGES["portal.subscribeEmailLabel"]);
    expect(field).toBeInstanceOf(HTMLInputElement);
    expect((field as HTMLInputElement).type).toBe("email");
    // The placeholder survives as the example it always was, and is not the name.
    expect((field as HTMLInputElement).placeholder).toBe("you@example.com");
  });

  it("speaks the resident's language, throughout", () => {
    render(<PublicSubscribeForm shareToken="share-token-12345" translator={translatorFor("es")} />);

    const es = buildPortalMessageBundle(resolvePortalLocale({ requested: "es", acceptLanguage: null })).messages;
    expect(screen.getByText(es["portal.subscribeHeading"])).toBeTruthy();
    expect(screen.getByText(es["portal.subscribeHint"])).toBeTruthy();
    expect(screen.getByLabelText(es["portal.subscribeEmailLabel"])).toBeTruthy();
    expect(screen.getByRole("button", { name: es["portal.subscribeSubmit"] })).toBeTruthy();

    // None of the English this form used to render for every reader.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Get email updates");
    expect(body).not.toContain("Notify me");
    expect(body).not.toContain("unsubscribe anytime");
  });

  /**
   * The component carries English fallbacks for a caller with no translator.
   * They are copies of the catalog's own English, and this makes disagreeing
   * with it a failure rather than a discovery — otherwise a caller without a
   * locale and one with `?lang=en` would read two different products.
   */
  it("falls back to the catalog's own English, word for word", () => {
    render(<PublicSubscribeForm shareToken="share-token-12345" />);

    expect(screen.getByText(EN_PORTAL_MESSAGES["portal.subscribeHeading"])).toBeTruthy();
    expect(screen.getByText(EN_PORTAL_MESSAGES["portal.subscribeHint"])).toBeTruthy();
    expect(screen.getByLabelText(EN_PORTAL_MESSAGES["portal.subscribeEmailLabel"])).toBeTruthy();
    expect(
      screen.getByRole("button", { name: EN_PORTAL_MESSAGES["portal.subscribeSubmit"] })
    ).toBeTruthy();
  });

  /**
   * THE HONEYPOT MUST STAY UNREACHABLE BY A PERSON. A filled honeypot is
   * discarded by `/api/engage/[shareToken]/subscribe` with no explanation to
   * anybody, which is right for a bot and destructive for a resident — so the
   * field is out of the tab order, out of the accessibility tree, and out of
   * reach of address autofill.
   *
   * `-start-` rather than `-left-`: `inset-inline-start` hides it off the
   * correct edge in a right-to-left page, where a negative `left` extends the
   * scrollable area instead.
   */
  it("keeps the spam honeypot out of a keyboard user's way", () => {
    const { container } = render(<PublicSubscribeForm shareToken="share-token-12345" />);

    const honeypot = container.querySelector("#subscribe-website") as HTMLInputElement;
    expect(honeypot).not.toBeNull();
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(honeypot.closest("div")?.className).toContain("-start-[9999px]");

    // And it is not what `getByLabelText` finds for the real field.
    expect(screen.getByLabelText(EN_PORTAL_MESSAGES["portal.subscribeEmailLabel"])).not.toBe(honeypot);
  });
});
