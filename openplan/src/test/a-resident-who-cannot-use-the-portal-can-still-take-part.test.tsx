import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortalAccessibilityNotice } from "@/components/engagement/portal-accessibility-notice";
import { CampaignAccessibilityEditor } from "@/components/engagement/campaign-accessibility-editor";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";
import type { PortalLocale } from "@/lib/engagement/portal-i18n/locales";
import type { PortalText } from "@/lib/engagement/portal-i18n/operator-text";

/**
 * THE PORTAL IS A MAP, A FORM AND A COMMENT FEED — each with people it does not
 * work for.
 *
 * A screen-reader user placing a pin, a resident on a phone with no data
 * allowance, somebody who reads none of the eleven offered languages, a person
 * who would rather speak to someone. For a consultation run by a public agency,
 * "could not take part" is not a usability statistic; it is the consultation
 * failing to hear from people it was required to reach.
 *
 * OpenPlan could already say a string was machine-translated, untranslated, or
 * unreadable. It had nothing to say about the one thing that resolves all of
 * those at once: a person at the agency to contact.
 */

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

function translatorFor(locale: PortalLocale) {
  return createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: locale })));
}

function operatorText(text: string, requestedLocale: PortalLocale, textLocale: PortalLocale): PortalText {
  return {
    text,
    provenance: textLocale === requestedLocale ? "operator" : "untranslated",
    textLocale,
    textLocaleStated: true,
    requestedLocale,
    model: null,
  };
}

describe("a resident who cannot use the portal can still take part", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders nothing at all when the agency has recorded nothing", () => {
    const { container } = render(
      <PortalAccessibilityNotice
        contactLabel={null}
        alternateFormats={null}
        email={null}
        phone={null}
        translator={translatorFor("en")}
      />
    );

    // An empty heading reads to a resident as an offer the agency did not make.
    // Nothing recorded is "the agency has not said", never "nothing is offered".
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the contact a resident can actually reach", () => {
    render(
      <PortalAccessibilityNotice
        contactLabel={operatorText("ADA Coordinator", "en", "en")}
        alternateFormats={operatorText("Paper copies at the front desk.", "en", "en")}
        email="access@city.example"
        phone="(555) 010-9900"
        translator={translatorFor("en")}
      />
    );

    expect(screen.getByText(/If you cannot use this page/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "access@city.example" })).toHaveAttribute(
      "href",
      "mailto:access@city.example"
    );
    expect(screen.getByRole("link", { name: "(555) 010-9900" })).toHaveAttribute("href", "tel:5550109900");
  });

  it("puts the offer in the reader's language, because that is who needs it", () => {
    render(
      <PortalAccessibilityNotice
        contactLabel={operatorText("Coordinador de Accesibilidad", "es", "es")}
        alternateFormats={null}
        email="access@city.example"
        phone={null}
        translator={translatorFor("es")}
      />
    );

    // The resident least able to read the rest of the page is exactly the one
    // who most needs this block.
    expect(screen.getByText(/Si no puede usar esta página/i)).toBeInTheDocument();
    expect(screen.getByText(/No tiene que explicar por qué/i)).toBeInTheDocument();
  });

  it("keeps an address left-to-right inside a right-to-left page", () => {
    const { container } = render(
      <PortalAccessibilityNotice
        contactLabel={null}
        alternateFormats={null}
        email="access@city.example"
        phone={null}
        translator={translatorFor("ar")}
      />
    );

    // An email is not prose. Inside an RTL page its punctuation reorders on
    // screen without this, which can make a correct address unreadable.
    const link = screen.getByRole("link", { name: "access@city.example" });
    expect(link.closest("dd")?.getAttribute("dir")).toBe("ltr");
    void container;
  });

  it("marks untranslated agency text as the language it is really in", () => {
    render(
      <PortalAccessibilityNotice
        contactLabel={operatorText("ADA Coordinator", "es", "en")}
        alternateFormats={null}
        email={null}
        phone={null}
        translator={translatorFor("es")}
      />
    );

    // Same rule as everywhere else on this portal: English inside a page
    // declared Spanish is labelled, never passed off as the agency's Spanish.
    expect(screen.getByText("ADA Coordinator").getAttribute("lang")).toBe("en");
    expect(screen.getByText(/no ha publicado este texto en Español/i)).toBeInTheDocument();
  });

  it("claims no conformance with any standard, anywhere in the block", () => {
    const { container } = render(
      <PortalAccessibilityNotice
        contactLabel={operatorText("Access Officer", "en", "en")}
        alternateFormats={operatorText("Call us and we will read it to you.", "en", "en")}
        email="a@b.example"
        phone="555"
        translator={translatorFor("en")}
      />
    );

    // OpenPlan has not audited itself against any standard. A portal asserting
    // it was accessible while a resident sat unable to use it would be a worse
    // failure than one that stayed quiet about it.
    expect(container.textContent).not.toMatch(/WCAG|Section 508|conform|accessible|compliant/i);
  });
});

describe("an agency records the contact itself", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  const renderEditor = (overrides: Partial<React.ComponentProps<typeof CampaignAccessibilityEditor>> = {}) =>
    render(
      <CampaignAccessibilityEditor
        campaignId="11111111-1111-4111-8111-111111111111"
        portalIsLive
        initial={{ contactLabel: null, contactEmail: null, contactPhone: null, alternateFormats: null }}
        {...overrides}
      />
    );

  it("suggests nothing, because the promise is the agency's to make", () => {
    renderEditor();

    // A default would put words in a public body's mouth about its own legal
    // duty, and an agency that found OpenPlan had promised an accommodation on
    // its behalf would be right to object.
    for (const label of [/who to contact/i, /^email$/i, /^phone$/i, /other ways to take part/i]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("warns when a live portal has nothing recorded", () => {
    renderEditor();

    expect(screen.getByRole("status")).toHaveTextContent(/no way to ask for another one/i);
  });

  it("does not nag about a portal nobody can reach yet", () => {
    renderEditor({ portalIsLive: false });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stops warning once something is recorded", () => {
    renderEditor({
      initial: {
        contactLabel: null,
        contactEmail: "access@city.example",
        contactPhone: null,
        alternateFormats: null,
      },
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("saves through the campaign route that already exists", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    renderEditor();

    fireEvent.change(screen.getByLabelText(/who to contact/i), { target: { value: "ADA Coordinator" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /save/i })));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/engagement/campaigns/11111111-1111-4111-8111-111111111111",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    const body = JSON.parse(
      ((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.accessibilityContactLabel).toBe("ADA Coordinator");
  });

  it("keeps what was typed when the save fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid campaign update payload" }),
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText(/other ways to take part/i), {
      target: { value: "Paper copies at the front desk." },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /save/i })));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Invalid campaign update payload/i);
    expect(screen.getByLabelText(/other ways to take part/i)).toHaveValue("Paper copies at the front desk.");
  });
});
