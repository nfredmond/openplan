/**
 * WHAT OTHER PEOPLE SAID, BESIDE THE MAP — the comment list, its topic colours
 * and filters, its shareable address, and the 3D switch, added 2026-10-10.
 *
 * Driven through `PublicMapShell` with the lifecycle fake, because every claim
 * here is about two things agreeing: the list a resident reads and the data the
 * map draws. A test of either half alone could pass while they disagree.
 *
 * jsdom has no box model and the fake draws nothing, so nothing here shows the
 * panel fits a phone, that colours are legible, or that buildings rise. Those
 * were checked in a browser at 1440 and 390 wide.
 */
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import { emptyPortalTranslationIndex, resolveOperatorText } from "@/lib/engagement/portal-i18n/operator-text";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import {
  PARTICIPANT_CATEGORY_PALETTE,
  resolveParticipantCategoryColors,
  UNCATEGORIZED_MAP_COLOR,
} from "@/lib/engagement/participant-category-colors";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";
import { buildPortalMapShellProps } from "@/lib/engagement/portal-surface-props";
import type { PublicPortalBundle } from "@/lib/engagement/public-portal-data";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const EN_MESSAGES = buildPortalMessageBundle(resolvePortalLocale({ requested: "en", acceptLanguage: null }));
const EN_INDEX = emptyPortalTranslationIndex("en");
const BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });

function text(value: string, entity: "campaign" | "category" = "campaign", id = "campaign-1") {
  return resolveOperatorText(EN_INDEX, { entity, id, field: entity === "category" ? "label" : "title" }, value);
}

const CATEGORIES = [
  { id: "cat-crossing", color: "#123456", labelText: text("Crossings", "category", "cat-crossing") },
  { id: "cat-transit", color: null, labelText: text("Transit", "category", "cat-transit") },
];

const ITEMS = [
  {
    id: "item-crossing",
    latitude: 39.2,
    longitude: -121.05,
    title: "Crossing is dangerous",
    body: "Cars turn without looking.",
    votesCount: 3,
    categoryId: "cat-crossing",
    color: "#123456",
    createdAt: "2026-07-27T12:00:00Z",
    parentItemId: null,
  },
  {
    id: "item-bus",
    latitude: 39.22,
    longitude: -121.07,
    title: "Later evening bus",
    body: "Shift workers need a later trip.",
    votesCount: 1,
    categoryId: "cat-transit",
    color: PARTICIPANT_CATEGORY_PALETTE[0],
    createdAt: "2026-07-26T12:00:00Z",
    parentItemId: null,
  },
  {
    id: "item-none",
    latitude: null,
    longitude: null,
    title: null,
    body: "General comment with no place.",
    votesCount: 0,
    categoryId: null,
    color: UNCATEGORIZED_MAP_COLOR,
    createdAt: "2026-07-25T12:00:00Z",
    parentItemId: null,
  },
];

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: CATEGORIES,
    items: ITEMS,
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    mapFraming: resolvePortalMapFraming({}),
    messages: EN_MESSAGES,
    campaignTitle: text("Downtown listening"),
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about",
    detailsContents: { survey: false, comments: true, closeLoop: false },
    mapAvailable: true,
    basemapChoices: BASEMAPS.choices,
    defaultBasemapId: BASEMAPS.defaultId,
    ...overrides,
  };
}

async function renderShell(overrides: Partial<ShellProps> = {}) {
  const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
  const view = render(<PublicMapShell {...shellProps(overrides)} />);
  const map = lastFakeMap();
  act(() => map.loadStyle());
  return { ...view, map };
}

function pointIds(map: ReturnType<typeof lastFakeMap>): string[] {
  const data = map.sourceData("engagement-points") as { features: { properties: { itemId: string } }[] };
  return data.features.map((feature) => feature.properties.itemId);
}

function listTitles(): string[] {
  return within(screen.getByTestId("portal-feed-list"))
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
  resetFakeMaps();
});

describe("the colour a topic is drawn in", () => {
  it("keeps the operator's own colour and gives every other topic the next palette colour, in topic order", () => {
    const colors = resolveParticipantCategoryColors([
      { id: "a", color: null },
      { id: "b", color: "#ABCDEF" },
      { id: "c", color: "not-a-colour" },
    ]);
    expect(colors.get("a")).toBe(PARTICIPANT_CATEGORY_PALETTE[0]);
    expect(colors.get("b")).toBe("#ABCDEF");
    // An unusable stored value is treated as no colour, not drawn as one.
    expect(colors.get("c")).toBe(PARTICIPANT_CATEGORY_PALETTE[1]);
  });

  it("never gives a topic the resident's own orange or the no-topic blue", () => {
    for (const color of PARTICIPANT_CATEGORY_PALETTE) {
      expect(color.toLowerCase()).not.toBe("#f97316");
      expect(color.toLowerCase()).not.toBe(UNCATEGORIZED_MAP_COLOR);
    }
  });

  it("is assigned on the server, so the map receives each comment's topic colour and reply count", () => {
    // Only the fields the builder reads; the rest of a bundle is irrelevant here.
    const approved = (id: string, categoryId: string | null, parentItemId: string | null = null) => ({
      id,
      categoryId,
      parentItemId,
      title: id,
      body: id,
      submittedBy: null,
      latitude: 39.2,
      longitude: -121.05,
      geometry: null,
      votesCount: 0,
      photoUrl: null,
      createdAt: "2026-07-27T12:00:00Z",
    });
    const bundle = {
      acceptingSubmissions: true,
      messages: EN_MESSAGES,
      campaignText: { title: text("Downtown listening"), summary: null, publicDescription: null },
      portalProps: {
        shareToken: "share-token-12345",
        configurationVersionId: null,
        categories: [
          { id: "cat-crossing", label: "Crossings", description: null, color: null, labelText: text("Crossings") },
          { id: "cat-transit", label: "Transit", description: null, color: "#123456", labelText: text("Transit") },
        ],
        approvedItems: [
          approved("crossing", "cat-crossing"),
          approved("transit", "cat-transit"),
          approved("deleted-topic", "cat-gone"),
          approved("reply", null, "crossing"),
        ],
        surveyQuestions: [],
        closeLoopEntries: [
          { id: "entry-1", themeTitleText: text("Crossings"), weDidText: text("Added a refuge island."), sourceItemIds: ["crossing"] },
        ],
        readFailures: { comments: false, categories: false, closeLoop: false, project: false },
        demographicsEnabled: false,
        mapFraming: resolvePortalMapFraming({}),
        contextLayers: null,
      },
    } as unknown as PublicPortalBundle;

    const props = buildPortalMapShellProps(bundle, { env: {} });
    const byId = Object.fromEntries(props.items.map((item) => [item.id, item]));

    expect(byId.crossing.color).toBe(PARTICIPANT_CATEGORY_PALETTE[0]);
    expect(byId.transit.color).toBe("#123456");
    expect(byId.crossing.replyCount).toBe(1);
    expect(byId.crossing.replies?.map((reply) => reply.id)).toEqual(["reply"]);
    expect(byId.crossing.teamResponses?.map((response) => response.weDidText.text)).toEqual(["Added a refuge island."]);
    expect(byId.transit.teamResponses).toEqual([]);
    // A topic since deleted reads as no topic, not as one the filter cannot find.
    expect(byId["deleted-topic"].categoryId).toBeNull();
    expect(byId["deleted-topic"].color).toBe(UNCATEGORIZED_MAP_COLOR);
    // Replies belong to a thread, not a place.
    expect(byId.reply).toBeUndefined();
    // The filter swatches use the same colours as the pins.
    expect(props.categories.map((category) => category.color)).toEqual([PARTICIPANT_CATEGORY_PALETTE[0], "#123456"]);
  });

  it("draws each pin in its topic's colour", async () => {
    const { map } = await renderShell();
    const data = map.sourceData("engagement-points") as {
      features: { properties: { itemId: string; color: string } }[];
    };
    const byId = Object.fromEntries(data.features.map((feature) => [feature.properties.itemId, feature.properties.color]));
    expect(byId["item-crossing"]).toBe("#123456");
    expect(byId["item-bus"]).toBe(PARTICIPANT_CATEGORY_PALETTE[0]);
  });
});

describe("what happened to a comment, on the comment", () => {
  it("shows the team's response and the replies inside the open comment", async () => {
    const withAnswers = ITEMS.map((item) =>
      item.id === "item-crossing"
        ? {
            ...item,
            replies: [{ id: "r1", body: "Same problem at First.", submittedBy: "Neighbour", createdAt: "2026-07-28T12:00:00Z" }],
            teamResponses: [{ id: "e1", themeTitleText: text("Crossings"), weDidText: text("Added a refuge island.") }],
          }
        : item
    );
    await renderShell({ items: withAnswers });
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    fireEvent.click(screen.getByText("Crossing is dangerous"));

    expect(screen.getByTestId("portal-feed-team-response")).toHaveTextContent("Added a refuge island.");
    expect(screen.getByTestId("portal-feed-replies")).toHaveTextContent("Same problem at First.");

    fireEvent.click(screen.getByRole("button", { name: "Next comment" }));
    expect(screen.queryByTestId("portal-feed-team-response")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-feed-replies")).not.toBeInTheDocument();
  });
});

describe("the list and the map show the same comments", () => {
  it("lists every comment, including one with no place, and counts them", async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));

    expect(listTitles()).toHaveLength(3);
    expect(screen.getByTestId("portal-feed-count")).toHaveTextContent("3");
    expect(listTitles()[2]).toContain(EN_MESSAGES.messages["portal.feedNoPlace"]);
  });

  it("hides a switched-off topic from the list AND the map", async () => {
    const { map } = await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));

    act(() => {
      fireEvent.click(within(screen.getByRole("group", { name: "Topics" })).getByRole("button", { name: "Transit" }));
    });

    expect(listTitles().some((title) => title.includes("Later evening bus"))).toBe(false);
    expect(pointIds(map)).toEqual(["item-crossing"]);
    expect(screen.getByTestId("portal-feed-count")).toHaveTextContent("2 of 3");
  });

  it("offers a filter only for topics somebody used, plus No topic when a comment has none", async () => {
    await renderShell({
      categories: [...CATEGORIES, { id: "cat-lighting", color: null, labelText: text("Lighting", "category", "cat-lighting") }],
    });
    fireEvent.click(screen.getByTestId("portal-feed-open"));

    const names = within(screen.getByRole("group", { name: "Topics" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["Crossings", "Transit", EN_MESSAGES.messages["portal.feedNoTopic"]]);
  });

  it("narrows the list and the map together when a resident searches", async () => {
    const { map } = await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));

    act(() => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search comments" }), { target: { value: "shift" } });
    });

    expect(listTitles()).toHaveLength(1);
    expect(listTitles()[0]).toContain("Later evening bus");
    expect(pointIds(map)).toEqual(["item-bus"]);
  });

  it("steps through comments in list order with previous and next", async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    fireEvent.click(screen.getByText("Crossing is dangerous"));

    expect(screen.getByTestId("portal-feed-position")).toHaveTextContent("1 of 3");
    expect(screen.getByRole("button", { name: "Previous comment" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next comment" }));
    expect(screen.getByTestId("portal-feed-detail")).toHaveTextContent("Later evening bus");
    expect(screen.getByTestId("portal-feed-position")).toHaveTextContent("2 of 3");
  });
});

describe("on a phone the list and the input sheet take turns", () => {
  it("closes the list when the sheet opens, and shuts the sheet when the list opens", async () => {
    await renderShell();
    const sheetToggle = document.getElementById("portal-sheet-toggle") as HTMLInputElement;

    fireEvent.click(screen.getByTestId("portal-feed-open"));
    expect(screen.getByTestId("portal-feed-panel")).toBeInTheDocument();

    fireEvent.click(sheetToggle);
    expect(sheetToggle.checked).toBe(true);
    expect(screen.queryByTestId("portal-feed-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("portal-feed-open"));
    expect(sheetToggle.checked).toBe(false);
  });
});

describe("found in review on 2026-10-10", () => {
  it("repaints a filter while the map's tiles are still loading after a pan", async () => {
    const { map } = await renderShell();
    map.tilesStillLoading = true;
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    act(() => {
      fireEvent.click(within(screen.getByRole("group", { name: "Topics" })).getByRole("button", { name: "Transit" }));
    });
    expect(pointIds(map)).toEqual(["item-crossing"]);
  });

  it("draws the resident's mark while tiles are still loading", async () => {
    const { map } = await renderShell();
    map.tilesStillLoading = true;
    map.renderedFeatures = [];
    act(() => map.tap());
    const draft = map.sourceData("engagement-draw") as { features: unknown[] };
    expect(draft.features.length).toBeGreaterThan(0);
  });

  it("clears search and topic filters when the list closes, and gives focus back to its button", async () => {
    const { map } = await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    act(() => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search comments" }), { target: { value: "shift" } });
    });
    expect(pointIds(map)).toEqual(["item-bus"]);

    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(pointIds(map)).toEqual(["item-crossing", "item-bus"]);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(document.activeElement).toBe(screen.getByTestId("portal-feed-open"));

    fireEvent.click(screen.getByTestId("portal-feed-open"));
    expect(screen.getByRole("searchbox", { name: "Search comments" })).toHaveValue("");
  });

  it("keeps focus on Next while stepping, and takes the controls under the list out of the tab order", async () => {
    const { container } = await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    const covered = container.querySelector("[inert]");
    expect(covered).not.toBeNull();
    fireEvent.click(screen.getByText("Crossing is dangerous"));

    const next = screen.getByRole("button", { name: "Next comment" });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByTestId("portal-feed-position")).toHaveTextContent("2 of 3");
    expect(document.activeElement).toBe(next);
  });

  it("brings a chosen pin into view without leaving the camera padded", async () => {
    const { map } = await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    fireEvent.click(screen.getByText("Later evening bus"));
    const move = map.easeToCalls.at(-1) ?? {};
    expect(move).toMatchObject({ center: [-121.07, 39.22] });
    expect(move).not.toHaveProperty("padding");
  });
});

describe("a comment has its own address", () => {
  it("puts the open comment in the address bar, and takes it out again", async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    fireEvent.click(screen.getByText("Later evening bus"));
    expect(new URL(window.location.href).searchParams.get("item")).toBe("item-bus");

    fireEvent.click(screen.getByRole("button", { name: EN_MESSAGES.messages["portal.feedBack"] }));
    expect(new URL(window.location.href).searchParams.get("item")).toBeNull();
  });

  it("opens the comment a shared link names, and rings it on the map", async () => {
    window.history.replaceState(null, "", "/engage/share-token-12345?item=item-bus");
    const { map } = await renderShell();

    expect(screen.getByTestId("portal-feed-detail")).toHaveTextContent("Shift workers need a later trip.");
    const selected = map.sourceData("engagement-selected") as { features: { properties: { itemId: string } }[] };
    expect(selected.features.map((feature) => feature.properties.itemId)).toEqual(["item-bus"]);
    // The link selects before the map has a style; the camera still goes there.
    expect(map.easeToCalls.at(-1)).toMatchObject({ center: [-121.07, 39.22] });
  });

  it("moves the camera to a comment chosen while the map's tiles are still loading", async () => {
    /*
      Seen in a browser on 2026-10-10: a shared link selected its comment after
      `style.load` but while tiles were still streaming, when Mapbox's own
      `isStyleLoaded()` says false, and the camera never moved.
    */
    const { map } = await renderShell();
    map.tilesStillLoading = true;
    fireEvent.click(screen.getByTestId("portal-feed-open"));
    fireEvent.click(screen.getByText("Later evening bus"));

    expect(map.easeToCalls.at(-1)).toMatchObject({ center: [-121.07, 39.22] });
    const selected = map.sourceData("engagement-selected") as { features: { properties: { itemId: string } }[] };
    expect(selected.features.map((feature) => feature.properties.itemId)).toEqual(["item-bus"]);
  });

  it("ignores an address naming a comment that is not here", async () => {
    window.history.replaceState(null, "", "/engage/share-token-12345?item=somebody-elses");
    await renderShell();
    expect(screen.queryByTestId("portal-feed-panel")).not.toBeInTheDocument();
  });
});

describe("a count is a claim", () => {
  it("prints no count when the comments could not be read", async () => {
    await renderShell({
      items: [],
      readFailures: { comments: true, categories: false, closeLoop: false, project: false },
    });
    const button = screen.getByTestId("portal-feed-open");
    expect(button.textContent).not.toMatch(/\d/);

    fireEvent.click(button);
    expect(screen.getByText(EN_MESSAGES.messages["portal.feedbackUnavailable"])).toBeInTheDocument();
    expect(screen.queryByText(EN_MESSAGES.messages["portal.feedEmpty"])).not.toBeInTheDocument();
  });
});

describe("the 3D switch", () => {
  it("does not move the camera until the resident flips it, then tilts and adds buildings", async () => {
    const { map, rerender } = await renderShell();
    // The background's own street data, which is where buildings come from.
    map.addSource("composite", {});
    // Re-render on a loaded map with new words, which re-runs the switch's
    // effect without the switch being touched. The camera must not move.
    const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
    const es = buildPortalMessageBundle(resolvePortalLocale({ requested: "es", acceptLanguage: null }));
    rerender(<PublicMapShell {...shellProps({ messages: es })} />);
    expect(map.easeToCalls).toEqual([]);

    const control = map.controls.find(
      (entry): entry is { button: HTMLButtonElement } =>
        typeof entry === "object" && entry !== null && "button" in entry
    );
    expect(control).toBeDefined();
    expect(control?.button.getAttribute("aria-pressed")).toBe("false");

    act(() => control?.button.click());

    expect(control?.button.getAttribute("aria-pressed")).toBe("true");
    expect(map.easeToCalls.at(-1)).toMatchObject({ pitch: 55 });
    expect(map.layerIds()).toContain("engagement-3d-buildings");

    act(() => control?.button.click());
    expect(map.easeToCalls.at(-1)).toMatchObject({ pitch: 0, bearing: 0 });
    expect(map.layerIds()).not.toContain("engagement-3d-buildings");
  });
});
