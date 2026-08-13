/**
 * A RESIDENT SHOULD NOT HAVE TO TYPE THEIR OWN EMAIL ADDRESS.
 *
 * The subscribe form is the last control on a long public page, reached mostly
 * on a phone. `autoComplete="email"` is what lets the browser and the phone's
 * keyboard offer the address the person already has stored; without it they
 * type it by hand into a small box, and a mistyped address means the updates
 * they asked for silently go nowhere. It sits one line below the label — and
 * until now only the label was guarded: removing `autoComplete="email"` left
 * `public-engagement-subscribe-form.test.tsx` green 4/4 (mutation M8,
 * 2026-08-13).
 *
 * THE PAIR IS THE POINT, which is why both fields are asserted in one place.
 * The same form carries a honeypot that must have `autoComplete="off"`: a
 * browser that autofills the hidden field gets the submission discarded by
 * `/api/engage/[shareToken]/subscribe` with no explanation to anybody, so the
 * two attributes are opposite halves of one decision. A guard on either alone
 * invites "make them consistent" as a fix in the wrong direction.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet and has no box
 * model, and it is not a browser's autofill engine: this is evidence that the
 * hint is on the field, not that any particular browser acts on it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PublicSubscribeForm } from "@/components/engagement/public-subscribe-form";
import { EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";

afterEach(cleanup);

describe("the public forms let a browser fill them in", () => {
  it("asks the browser for the resident's own email address", () => {
    render(<PublicSubscribeForm shareToken="share-token-12345" />);

    // Found the way a resident using a screen reader finds it, so this cannot
    // pass by matching some other input on the form.
    const field = screen.getByLabelText(
      EN_PORTAL_MESSAGES["portal.subscribeEmailLabel"]
    ) as HTMLInputElement;

    expect(field.getAttribute("autocomplete")).toBe("email");
    // `inputMode` is the phone-keyboard half of the same intent: an "@" and a
    // "." without switching keyboard pages.
    expect(field.getAttribute("inputmode")).toBe("email");
    expect(field.type).toBe("email");
  });

  it("keeps autofill out of the honeypot beside it", () => {
    const { container } = render(<PublicSubscribeForm shareToken="share-token-12345" />);

    const honeypot = container.querySelector("#subscribe-website") as HTMLInputElement;
    expect(honeypot).not.toBeNull();
    expect(honeypot.getAttribute("autocomplete")).toBe("off");

    // And the two are genuinely different fields, so this file cannot pass by
    // asserting the same attribute twice.
    expect(honeypot).not.toBe(
      screen.getByLabelText(EN_PORTAL_MESSAGES["portal.subscribeEmailLabel"])
    );
  });
});
