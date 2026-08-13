/**
 * MOVING A CAPABILITY IS NOT LOSING IT — provided something checks that the move
 * landed.
 *
 * The map-first shell took over `/engage/<token>` and pushed the survey, the
 * comment feed, the close-the-loop record, the topic descriptions, the email
 * subscription, the classic submission form and the accessibility contact to
 * `/engage/<token>/about`. That is a redesign one broken link away from being a
 * deletion, and a deletion of exactly the things nobody would notice quickly: a
 * survey nobody can reach still looks fine on the map.
 *
 * ============================================================================
 * WHAT THIS FILE USED TO PROVE, AND WHY IT WAS NOT ENOUGH
 * ============================================================================
 *
 * Its whole claim rested on `existsSync()` — the link points at a path, and a
 * file exists there. That would stay green if the page at that path rendered an
 * empty `<div>`. "Loses nothing" is a claim about CONTENT, so it is checked as
 * one here, in two halves that together cover the drift:
 *
 *   1. the four capabilities actually render (a real render of the component
 *      the context page mounts, carrying a survey, an approved comment, a
 *      close-the-loop record and the subscribe form); and
 *   2. the whole `portalProps` object reaches that component from the route —
 *      read out of source, because the way this gets deleted is somebody
 *      passing a hand-picked subset of fields, which type-checks and silently
 *      drops whatever they forgot.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet, has no box model,
 * and does not run Mapbox GL. Nothing here is evidence about size, position or
 * visibility of anything. What actually gets DRAWN on the map is
 * `public-engagement-map-stage-paints.test.tsx`, which drives a real map
 * lifecycle; this file is about what did not move onto it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import {
  emptyPortalTranslationIndex,
  resolveOperatorText,
} from "@/lib/engagement/portal-i18n/operator-text";
import { PublicEngagementPortal } from "@/components/engagement/public-engagement-portal";
import { buildParticipantPopupContent } from "@/components/engagement/public-map-stage";
import {
  PUBLIC_BASEMAP_DEFAULT_ENV,
  PUBLIC_BASEMAP_OFFER_ENV,
  resolvePublicBasemapConfig,
} from "@/lib/cartographic/basemaps";
import { stripSourceComments } from "@/test/helpers/source-text";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const SRC = path.join(process.cwd(), "src");
const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const EN_MESSAGES = buildPortalMessageBundle(EN_LOCALE);
const EN_INDEX = emptyPortalTranslationIndex("en");

function operatorText(text: string, field = "title") {
  return resolveOperatorText(EN_INDEX, { entity: "campaign", id: "campaign-1", field }, text);
}

/** Source with every comment blanked — a paragraph ABOUT the code is not the code. */
function code(relative: string): string {
  return stripSourceComments(readFileSync(path.join(SRC, relative), "utf8"));
}

/** One published layer, so the layer picker has something to be about. */
const CONTEXT_LAYERS: ParticipantContextLayerSet = {
  layers: [
    {
      id: "layer-1",
      name: "Proposed alignment",
      description: null,
      color: "#38bdf8",
      geometryKinds: ["LineString"],
      featureCollection: { type: "FeatureCollection", features: [] },
      bbox: null,
      coverageNotes: [],
    },
  ],
  readFailure: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the one way onward actually goes somewhere", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  });

  it("links to a route that exists on disk", async () => {
    const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
    render(
      <PublicMapShell
        {...{
          shareToken: "share-token-12345",
          acceptingSubmissions: true,
          categories: [],
          items: [],
          readFailures: { comments: false, categories: false, closeLoop: false, project: false },
          mapFraming: resolvePortalMapFraming({}),
          messages: EN_MESSAGES,
          campaignTitle: operatorText("Downtown listening campaign"),
          campaignDescription: null,
          detailsHref: "/engage/share-token-12345/about",
          detailsContents: { survey: true, comments: true, closeLoop: true },
          mapAvailable: true,
        }}
      />
    );

    const href = screen.getByTestId("portal-details-link").getAttribute("href") ?? "";

    /*
      THE HREF IS TURNED BACK INTO A FILE PATH RATHER THAN COMPARED TO A SECOND
      HARDCODED STRING. A test that asserted the link equals "/engage/x/about"
      and, separately, that a file exists at that path, would pass happily after
      somebody deleted the route and edited both lines. Deriving the path FROM
      the rendered href means the link and the page it claims to reach cannot
      drift apart.
    */
    const segments = href.split("?")[0].split("/").filter(Boolean);
    expect(segments[0]).toBe("engage");
    const trailing = segments.slice(2).join("/");
    const routeFile = path.join(
      process.cwd(),
      "src/app/(portal)/engage/[shareToken]",
      trailing,
      "page.tsx"
    );
    expect(existsSync(routeFile)).toBe(true);
  });
});

describe("what is behind the door is still there", () => {
  /**
   * The four capabilities that MOVED, rendered. Everything else about this
   * component is covered by `public-engagement-portal.test.tsx`; what is
   * checked here is that a portal carrying all four still shows all four, so
   * the reachability chain below is a chain to something real.
   */
  it("renders the survey, the community's comments, the close-the-loop record and the subscribe form", () => {
    render(
      <PublicEngagementPortal
        shareToken="share-token-12345"
        acceptingSubmissions
        engagementType="map_feedback"
        categories={[]}
        approvedItems={[
          {
            id: "item-1",
            categoryId: null,
            title: "Crossing is dangerous",
            body: "Cars turn without looking.",
            submittedBy: null,
            latitude: 39.2,
            longitude: -121.05,
            geometry: null,
            votesCount: 3,
            parentItemId: null,
            photoUrl: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ]}
        surveyQuestions={[
          {
            id: "question-1",
            questionType: "free_text",
            prompt: "What would you change first?",
            helpText: null,
            required: false,
            config: {},
            mapFramingNote: null,
            promptText: operatorText("What would you change first?", "prompt"),
            helpTextText: null,
            options: [],
          },
        ]}
        closeLoopEntries={[
          {
            id: "entry-1",
            themeTitle: "Crossing times",
            youSaid: "The signal is too short.",
            weDid: "We lengthened it in March.",
            categoryLabel: null,
            themeTitleText: operatorText("Crossing times", "theme_title"),
            youSaidText: operatorText("The signal is too short.", "you_said"),
            weDidText: operatorText("We lengthened it in March.", "we_did"),
            categoryLabelText: null,
          },
        ]}
        emailUpdatesAvailable
        mapFraming={resolvePortalMapFraming({})}
        locale={EN_LOCALE}
        messages={EN_MESSAGES}
      />
    );

    /*
      EACH ONE OPENED AND READ, not counted off a tab strip. The four live
      behind tabs, and a tab is exactly the thing that can be present over an
      empty panel — so every assertion below is on the CONTENT: a question, a
      resident's own sentence, the agency's own commitment.

      The tab labels come from the real catalog rather than being typed here; a
      literal would assert copy this portal may not carry.
    */
    const openTab = (key: "portal.tab.survey" | "portal.tab.closeLoop" | "portal.tab.feedback") => {
      const label = EN_MESSAGES.messages[key];
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    };

    openTab("portal.tab.survey");
    expect(screen.getByText("What would you change first?")).toBeInTheDocument();

    openTab("portal.tab.feedback");
    expect(screen.getByText("Cars turn without looking.")).toBeInTheDocument();

    openTab("portal.tab.closeLoop");
    expect(screen.getByText("We lengthened it in March.")).toBeInTheDocument();

    /*
      And the way to hear what happens next, which is not behind a tab at all.

      Found by its LABEL since 2026-08-13. It used to be found by its input type,
      because the field had no label at all: a bare `<Input type="email">` with a
      placeholder, which a screen reader announces as "edit text" with no name.
      That defect is fixed and `public-engagement-subscribe-form.test.tsx` is
      what holds it fixed; this file's job is only to prove the form did not
      disappear in the move, so it now asks for the field the way a resident
      using a screen reader would find it.
    */
    expect(
      screen.getByRole("button", { name: EN_MESSAGES.messages["portal.subscribeSubmit"] })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(EN_MESSAGES.messages["portal.subscribeEmailLabel"])).toBeInTheDocument();
  });

  /**
   * THE CHAIN, READ OUT OF SOURCE. The render above proves the component shows
   * all four; this proves the context route reaches that component with the
   * WHOLE bundle rather than a hand-picked set of fields.
   *
   * Why a spread and not a list of props: TypeScript does not excess-property-
   * check a spread, and it does not complain about a prop nobody passed when it
   * is optional — which is how `closeLoop` and `project` were dropped once
   * already. `{...portalProps}` cannot lose a field that the loader produces;
   * eleven named props can lose one per edit, silently.
   */
  it("hands the context route's whole bundle to that component, not a hand-picked subset", () => {
    const route = code("app/(portal)/engage/[shareToken]/about/page.tsx");
    const surface = code("components/engagement/portal-context-page.tsx");

    // The route renders the shared context page and gives it the whole bundle.
    expect(route).toMatch(/<PortalContextPage[\s\S]*?bundle=\{bundle\}/);
    // Which spreads the loader's own props object into the portal.
    expect(surface).toMatch(/<PublicEngagementPortal\s*\{\.\.\.portalProps\}/);
    // And that object is the bundle's, unfiltered — not rebuilt on the way in.
    expect(surface).toMatch(/const \{[^}]*portalProps[^}]*\} =\s*\n?\s*bundle;/);
  });
});

describe("the vote a resident can only reach from the map", () => {
  /**
   * A UNIT TEST OF THE POPUP BUILDER, and nothing more — stated because it used
   * to claim more. It calls the builder directly with a handler of its own, so
   * it CANNOT see a stage that stopped passing `onSupport`: deleting that prop
   * left this test green. That wiring is now proved in
   * `public-engagement-map-stage-paints.test.tsx`, which reads the popup off a
   * marker the real paint path built.
   */
  it("puts the catalog's own words on the button, and calls the handler it was given", async () => {
    const onSupport = vi.fn(async () => 4);
    const content = buildParticipantPopupContent(
      {
        id: "item-1",
        latitude: 39.2,
        longitude: -121.05,
        title: "Crossing is dangerous",
        body: "Cars turn without looking.",
        votesCount: 3,
      },
      {
        onSupport,
        hasVoted: () => false,
        // From the real catalog, not a literal: these two strings were English
        // literals inside the old display map, so a Spanish portal's only map
        // vote button said "Support".
        supportLabel: EN_MESSAGES.messages["portal.support"],
        supportedLabel: EN_MESSAGES.messages["portal.supported"],
      }
    );

    document.body.appendChild(content);
    const button = content.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toContain("Support");
    expect(button.textContent).toContain("3");

    button.click();
    expect(onSupport).toHaveBeenCalledWith("item-1");

    // The resident's own words are set as TEXT, never interpolated into HTML.
    expect(content.textContent).toContain("Cars turn without looking.");
  });

  it("shows no support control when no handler was wired through", () => {
    const content = buildParticipantPopupContent(
      { id: "item-1", latitude: 1, longitude: 1, title: null, body: "words", votesCount: 3 },
      { hasVoted: () => false, supportLabel: "Support", supportedLabel: "Supported" }
    );
    expect(content.querySelector("button")).toBeNull();
  });
});

describe("the map controls a resident actually gets", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
  });

  /**
   * THE SHIPPED-INVISIBLE CASE, caught before it shipped. The background picker
   * and the layer picker were built complete, tested, and mounted by NOTHING —
   * the eleventh instance of this repository's most common defect. This asserts
   * they are reachable from the surface a resident opens, and that the choice
   * they make reaches the map rather than only the button's own state.
   */
  it("mounts the shared background and layer pickers on the map, wired to the map's style", async () => {
    const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
    /*
      THE DEFAULT IS DELIBERATELY NOT THE FIRST CHOICE. With the product default
      (`streets`, which is also first in the offer) this assertion passed with
      the stage replaced by `basemapChoices[0]` — it could not tell "the map
      opened on the configured default" from "the map opened on whatever was
      listed first". Configuring the offer so the two differ is what makes it a
      test of the binding.
    */
    const config = resolvePublicBasemapConfig({
      mapboxToken: "pk.test",
      env: {
        [PUBLIC_BASEMAP_OFFER_ENV]: "streets,satellite",
        [PUBLIC_BASEMAP_DEFAULT_ENV]: "satellite",
      },
    });
    expect(config.choices.length).toBeGreaterThan(1);
    expect(config.choices[0].id).not.toBe(config.defaultId);

    render(
      <PublicMapShell
        {...{
          shareToken: "share-token-12345",
          acceptingSubmissions: true,
          categories: [],
          items: [],
          readFailures: { comments: false, categories: false, closeLoop: false, project: false },
          contextLayers: CONTEXT_LAYERS,
          mapFraming: resolvePortalMapFraming({}),
          messages: EN_MESSAGES,
          campaignTitle: operatorText("Downtown listening campaign"),
          campaignDescription: null,
          detailsHref: "/engage/share-token-12345/about",
          detailsContents: { survey: false, comments: false, closeLoop: false },
          mapAvailable: true,
          basemapChoices: config.choices,
          defaultBasemapId: config.defaultId,
        }}
      />
    );

    expect(screen.getByTestId("public-map-pickers")).toBeInTheDocument();

    // The map opens on the configured default, read back off the stage rather
    // than off the button — a picker whose selection never reached the map
    // would still highlight the right option.
    const openingStyle = config.choices.find((choice) => choice.id === config.defaultId)?.styleUrl;
    const firstStyle = config.choices[0].styleUrl;
    // READ OFF AN ATTRIBUTE, NOT OFF TEXT. This hook used to be an `sr-only`
    // span, which is visually hidden but deliberately NOT hidden from assistive
    // technology — so the raw `mapbox://styles/…` URL was read aloud to blind
    // residents on the public portal. The observation is identical from a
    // `data-` attribute and silent to a screen reader.
    const stage = screen.getByTestId("portal-map-basemap");
    expect(stage).toHaveAttribute("data-basemap-style", String(openingStyle));
    expect(stage).not.toHaveAttribute("data-basemap-style", String(firstStyle));
  });
});
