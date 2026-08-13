/**
 * THE TWO MAP CONTROLS A MEMBER OF THE PUBLIC GETS — what they may offer, and
 * where their options come from.
 *
 * WHAT THESE TESTS DO NOT PROVE. jsdom applies no stylesheet, has no box model,
 * and Mapbox GL does not run in it at all. Nothing below can show that the dock
 * does not cover the map, that a panel fits a 390px phone, that a tap target is
 * really 44px, or that a chosen background actually renders. Those are browser
 * facts and have to be looked at once by hand. What is provable here is
 * structural, and it is the part that has historically shipped wrong: WHICH
 * layers reach a resident's screen, and WHERE a style id comes from.
 */
import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_BASEMAP_DEFAULT_ENV,
  PUBLIC_BASEMAP_OFFER_ENV,
  resolvePublicBasemapConfig,
  type PublicBasemapChoice,
} from "@/lib/cartographic/basemaps";
import {
  loadParticipantContextLayers,
  type ContextLayerRow,
} from "@/lib/engagement/context-layers";

import { PublicBasemapPicker } from "@/components/engagement/public-map-picker-basemap";
import { PublicMapLayerPicker } from "@/components/engagement/public-map-picker-layers";
import { PublicMapPickers } from "@/components/engagement/public-map-pickers";
import { stripSourceComments } from "@/test/helpers/source-text";

afterEach(cleanup);

const SRC = path.join(process.cwd(), "src");

function read(relative: string): string {
  return fs.readFileSync(path.join(SRC, relative), "utf8");
}

// ── A fake table that honours the filters, not one that ignores them ─────────

/**
 * A mocked Supabase client that returns a fixed array proves nothing about a
 * `.eq()` chain — the chain IS the access control on a service-role read. This
 * double holds ROWS and applies the equality filters it is given, so a query
 * that forgets `visible_to_participants` returns the unpublished layer and the
 * assertion downstream fails.
 */
function filteringClient(rows: Array<Partial<ContextLayerRow>>) {
  const make = () => {
    let matched = rows;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        matched = matched.filter((row) => (row as Record<string, unknown>)[column] === value);
        return builder;
      },
      order: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: matched, error: null }).then(resolve),
    };
    return builder;
  };
  return { from: () => make() };
}

function layerRow(overrides: Partial<ContextLayerRow>): Partial<ContextLayerRow> {
  return {
    id: "layer-1",
    campaign_id: "campaign-1",
    name: "Proposed alignment",
    description: null,
    geometry_kinds: ["LineString"],
    display_color: "#38bdf8",
    features: { type: "FeatureCollection", features: [] },
    bbox: null,
    feature_count: 3,
    source_feature_count: 3,
    dropped_feature_count: 0,
    truncated: false,
    visible_to_participants: true,
    ...overrides,
  };
}

describe("the layer picker offers exactly what the campaign published", () => {
  it("lists the campaign's published layers and no others", async () => {
    const set = await loadParticipantContextLayers(
      filteringClient([
        layerRow({ id: "a", name: "Proposed alignment", visible_to_participants: true }),
        // Uploaded but never published — the operator has not made this public.
        layerRow({ id: "b", name: "Draft right-of-way", visible_to_participants: false }),
        // Published, but on a DIFFERENT campaign.
        layerRow({ id: "c", name: "Another campaign's parcels", campaign_id: "campaign-2" }),
      ]) as never,
      "campaign-1"
    );

    render(
      <PublicMapLayerPicker
        contextLayers={set}
        visibleLayerIds={["a"]}
        onVisibleLayerIdsChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));

    expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
    expect(screen.queryByText("Draft right-of-way")).not.toBeInTheDocument();
    expect(screen.queryByText("Another campaign's parcels")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("does not reach workspace GIS layers, which carry no public-intent flag", () => {
    /*
      `workspace_gis_layers` has `default_visible`, which is whether a PLANNER's
      own map switches the layer on. There is no column anywhere on that table
      meaning "a member of the public may see this". Drawing those layers on a
      participant map would therefore publish internal data on the strength of a
      setting that never meant that — so the public picker path must not be able
      to read them at all.

      This walks the picker's own source and its first-party imports rather than
      trusting the component to filter, because a filter is something a later
      edit removes and a missing import is not.
    */
    const sources = [
      "components/engagement/public-map-picker-layers.tsx",
      "components/engagement/public-map-picker-basemap.tsx",
      "components/engagement/public-map-pickers.tsx",
      "lib/engagement/context-layers.ts",
      "lib/cartographic/basemaps.ts",
    ];
    for (const relative of sources) {
      // Comments explain the decision; only CODE may not reach the table. The
      // shared stripper, never a private copy — three of those existed and no
      // two behaved alike (`one-comment-stripper.test.ts`).
      const body = stripSourceComments(read(relative));
      expect(body, `${relative} must not read workspace GIS data`).not.toMatch(/workspace_gis/);
    }
  });

  it("says a failed read failed instead of rendering an empty campaign", () => {
    render(
      <PublicMapLayerPicker
        contextLayers={{ layers: [], readFailure: "permission denied for table" }}
        visibleLayerIds={[]}
        onVisibleLayerIdsChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    // And it must not leak the database's own words to a member of the public.
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there is nothing published and nothing broken", () => {
    const { container } = render(
      <PublicMapLayerPicker
        contextLayers={{ layers: [], readFailure: null }}
        visibleLayerIds={[]}
        onVisibleLayerIdsChange={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a truncation notice visible even while the layer is switched off", async () => {
    // "You are seeing 500 of 4,000 parcels" stays true whether or not the
    // resident is currently looking at them; hiding it with the layer would let
    // a display choice retract a disclosure.
    const set = await loadParticipantContextLayers(
      filteringClient([
        layerRow({ id: "a", feature_count: 500, source_feature_count: 4000, truncated: true }),
      ]) as never,
      "campaign-1"
    );

    render(
      <PublicMapLayerPicker
        contextLayers={set}
        visibleLayerIds={[]}
        onVisibleLayerIdsChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));
    expect(screen.getByText(/showing 500 of 4,000 shapes/i)).toBeInTheDocument();
  });

  it("hands back the whole next set of visible ids, not just the one clicked", async () => {
    const set = await loadParticipantContextLayers(
      filteringClient([layerRow({ id: "a" }), layerRow({ id: "b", name: "Parcels" })]) as never,
      "campaign-1"
    );
    const onChange = vi.fn();

    render(
      <PublicMapLayerPicker
        contextLayers={set}
        visibleLayerIds={["a", "b"]}
        onVisibleLayerIdsChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(onChange).toHaveBeenCalledWith(["b"]);
  });
});

// ── The background picker ────────────────────────────────────────────────────

describe("where the map backgrounds come from", () => {
  it("spells no style id inside any picker component", () => {
    /*
      The product's existing failure mode: twelve map call sites each hardcode
      their own `mapbox://styles/...`, none can see the others, and they have
      drifted. A picker carrying a thirteenth list would put that drift in front
      of the public AND could offer a style this deployment's token cannot load.
    */
    for (const relative of [
      "components/engagement/public-map-picker-basemap.tsx",
      "components/engagement/public-map-pickers.tsx",
    ]) {
      expect(read(relative), `${relative} must not name a map style`).not.toMatch(
        /mapbox:\/\/styles/
      );
    }
  });

  it("offers nothing when the deployment has no usable Mapbox token", () => {
    // `resolvePublicMapboxToken` returns "" for a missing token AND for a
    // mis-scoped `sk.` one. Either way Mapbox draws nothing, and a background
    // picker over a map that does not exist is a control that lies.
    const config = resolvePublicBasemapConfig({ mapboxToken: "", env: {} });
    expect(config.choices).toEqual([]);
    expect(config.defaultId).toBeNull();
  });

  it("takes the offer and its order from the operator's configuration", () => {
    const config = resolvePublicBasemapConfig({
      mapboxToken: "pk.test",
      env: { [PUBLIC_BASEMAP_OFFER_ENV]: "satellite, streets" },
    });
    expect(config.choices.map((choice) => choice.id)).toEqual(["satellite", "streets"]);
    expect(config.defaultId).toBe("satellite");
  });

  it("drops a configured background OpenPlan does not know, and says so", () => {
    // Passing an unknown id through to Mapbox is exactly how a blank rectangle
    // reaches a resident. The note is operator-facing and never rendered
    // publicly.
    const config = resolvePublicBasemapConfig({
      mapboxToken: "pk.test",
      env: { [PUBLIC_BASEMAP_OFFER_ENV]: "streets,my-studio-style" },
    });
    expect(config.choices.map((choice) => choice.id)).toEqual(["streets"]);
    expect(config.configNotes.join(" ")).toContain("my-studio-style");
  });

  it("refuses a default that is not among the offered backgrounds", () => {
    const config = resolvePublicBasemapConfig({
      mapboxToken: "pk.test",
      env: {
        [PUBLIC_BASEMAP_OFFER_ENV]: "streets,satellite",
        [PUBLIC_BASEMAP_DEFAULT_ENV]: "terrain",
      },
    });
    expect(config.defaultId).toBe("streets");
    expect(config.configNotes.join(" ")).toContain("terrain");
  });

  it("opens on a daylight street map when nothing is configured", () => {
    // Not `dark-v11`. A resident arriving from a postcard is looking for their
    // own street on a phone in daylight.
    const config = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });
    expect(config.defaultId).toBe("streets");
    expect(config.choices.length).toBeGreaterThan(1);
  });

  it("names every choice in words a resident would use", () => {
    const config = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });
    for (const choice of config.choices) {
      expect(choice.label).not.toMatch(/basemap|style|mapbox|v1[12]|tileset/i);
      expect(choice.description.length).toBeGreaterThan(0);
    }
  });
});

describe("the background picker on screen", () => {
  const choices = resolvePublicBasemapConfig({
    mapboxToken: "pk.test",
    env: { [PUBLIC_BASEMAP_OFFER_ENV]: "streets,satellite" },
  }).choices;

  it("renders one option per configured choice and reports the pick", () => {
    const onSelect = vi.fn<(choice: PublicBasemapChoice) => void>();
    render(<PublicBasemapPicker choices={choices} selectedId="streets" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /map background/i }));

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /satellite/i }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "satellite" }));
  });

  it("renders nothing when there is only one background — that is not a choice", () => {
    const { container } = render(
      <PublicBasemapPicker choices={choices.slice(0, 1)} selectedId="streets" onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a background the map could not load instead of leaving it selectable", () => {
    // Mapbox reports an unloadable style as an `error` event rather than by
    // throwing, so a failed switch otherwise looks exactly like a slow one.
    render(
      <PublicBasemapPicker
        choices={choices}
        selectedId="streets"
        onSelect={vi.fn()}
        failedChoiceId="satellite"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /map background/i }));
    const failed = screen.getByRole("radio", { name: /satellite/i });
    expect(failed).toBeDisabled();
    expect(screen.getByText(/not available on this site/i)).toBeInTheDocument();
  });
});

describe("the docked pair", () => {
  it("declares the language its own words are written in", () => {
    // The portal renders 22 locales and only ONE non-English catalog exists.
    // Until `portal.*` keys are added, these strings are English inside a
    // surface that may declare Farsi or Arabic, so the element has to say so —
    // the same rule `PENDING_PORTAL_TEXT` follows.
    render(
      <PublicMapPickers
        contextLayers={{
          layers: [
            {
              id: "a",
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
        }}
        visibleLayerIds={["a"]}
        onVisibleLayerIdsChange={vi.fn()}
        basemapChoices={
          resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} }).choices
        }
        selectedBasemapId="streets"
        onBasemapSelect={vi.fn()}
      />
    );

    expect(screen.getByTestId("public-map-layer-picker")).toHaveAttribute("lang", "en");
    expect(screen.getByTestId("public-basemap-picker")).toHaveAttribute("lang", "en");
  });

  it("lets a drag between the two controls reach the map", () => {
    // The gap between the buttons is map. A wrapper that swallowed pointer
    // events there would make part of the map undraggable with nothing visible
    // to explain why. (Structural only — jsdom does not do hit testing.)
    render(
      <PublicMapPickers
        contextLayers={{ layers: [], readFailure: null }}
        visibleLayerIds={[]}
        onVisibleLayerIdsChange={vi.fn()}
        basemapChoices={
          resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} }).choices
        }
        selectedBasemapId="streets"
        onBasemapSelect={vi.fn()}
      />
    );
    const dock = screen.getByTestId("public-map-pickers");
    expect(dock.className).toContain("pointer-events-none");
    expect(screen.getByTestId("public-basemap-picker").className).toContain("pointer-events-auto");
  });
});
