/**
 * A PLANNER CAN GET THE PAGE OUT OF THE WAY OF THEIR OWN MAP LAYERS — AND
 * EVERY OTHER PAGE IN THE PRODUCT IS UNTOUCHED BY THAT.
 *
 * ═══ THE DEFECT ═══
 *
 * v0.19.0 shipped the layer library. A planner uploaded a bike network, went to
 * Safety to look at it, and saw it only in the 16px gutters around the page
 * panel. `.op-cart-surface` is `position: fixed` across roughly three quarters
 * of the window at `--panel` — 94% opaque in every light palette, 92% in every
 * dark one — over an 18px backdrop blur. Composited, a solid fill directly
 * beneath it moves the panel by under 4% of one channel and a 2px line
 * contributes on the order of one part in 255. The layer was drawn. It could
 * not be seen.
 *
 * ═══ WHY THIS IS A MODE AND NOT AN OPACITY ═══
 *
 * Because lowering the opacity fails in both directions at once. It cannot
 * deliver the goal — a hairline under an 18px blur stays invisible at any
 * translucency short of transparent — and it takes `--muted`, which carries
 * kickers, meta rows and placeholders at 10.5–12px, from 3.37:1 to 2.57:1 in
 * light and 3.45:1 to 2.28:1 in dark. `surface-text-stays-legible.test.ts` is
 * the executable half of that argument and exists to stop a future model
 * "just lowering the opacity".
 *
 * ═══ WHAT THESE TESTS HOLD ═══
 *
 * The mechanism, at the two levels it has to be right at:
 *
 *   1. the RENDERED level — the control exists, is a real button, is keyboard
 *      reachable, announces its state, takes the surface out of the focus order
 *      and the a11y tree, LEAVES the layer controls working, and has two ways
 *      back;
 *   2. the STYLESHEET level — the rule that actually removes the panel exists,
 *      is scoped to the mode's attribute so no ordinary page can be affected by
 *      it, honours `prefers-reduced-motion`, and does not touch `--panel`.
 *
 * jsdom applies no stylesheet, so (1) cannot see the panel move and (2) cannot
 * see a pixel. Neither is a proof of compositing and neither claims to be. The
 * honest decomposition is: the map is uncovered (2), the control that uncovers
 * it is reachable and reversible (1), and the layer is registered on the map
 * with legible paint (the painting lane's tests). A screenshot would add pixel
 * evidence and is a reasonable follow-up, not a substitute for any of these.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/safety",
  useSearchParams: () => searchParams,
}));

import { CartographicLayerDeepLink } from "@/components/cartographic/cartographic-layer-deep-link";
import { CartographicLayersPanel } from "@/components/cartographic/cartographic-layers-panel";
import { CartographicMapReadingToggle } from "@/components/cartographic/cartographic-map-reading-toggle";
import { CartographicOverviewSurface } from "@/components/cartographic/cartographic-overview-surface";
import {
  CartographicProvider,
  useWorkspaceMapLayers,
} from "@/components/cartographic/cartographic-context";
import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";
import { stripSourceComments } from "./helpers/source-text";

const ORIGINAL_FETCH = global.fetch;

function listing(id: string, name: string): WorkspaceGisLayerListing {
  return {
    layer: {
      id,
      workspaceId: "ws-1",
      projectId: null,
      name,
      description: null,
      style: { color: "#d55e00", opacity: 0.8, lineWidth: 2.5, labelField: null },
      defaultVisible: true,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: {
        id: `${id}-v1`,
        layerId: id,
        versionNumber: 1,
        sourceFormat: "geojson",
        sourceFilename: `${name}.geojson`,
        sourceByteSize: 1024,
        hasStoredSource: true,
        reprojectionEngine: "none",
        datumShiftNote: null,
        datumAcknowledgedBy: null,
        declaredFeatureCount: 412,
        sourceFeatureCount: 412,
        featureCount: 412,
        geometryKinds: ["LineString"],
        attributeFields: [],
        attributeEncoding: null,
        attributeEncodingIsFallback: false,
        srs: {
              authority: "EPSG",
              code: "4326",
              name: "WGS 84",
              basis: "geojson_rfc7946_default",
              assertedBy: null,
              assertedAt: null,
            },
        droppedFeatureCount: 0,
        truncated: false,
        bbox: [-121.1, 39.1, -120.9, 39.3],
        ingestStatus: "ready",
        ingestFailureReason: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        finalizedAt: "2026-08-12T00:05:00.000Z",
      },
    },
    notes: [],
  };
}

/** Registers a catalog the way the map backdrop does. */
function Seed({ listings }: { listings: WorkspaceGisLayerListing[] }) {
  const { registerWorkspaceLayers } = useWorkspaceMapLayers();
  useEffect(() => {
    registerWorkspaceLayers(listings, "ws-1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerWorkspaceLayers]);
  return null;
}

/**
 * The real shell chrome, in the real provider: the page panel, the dock control
 * that hides it, and the layers panel that has to survive it. Assembled here
 * exactly as `cartographic-shell` assembles it, because the whole point is the
 * relationship between the three.
 */
function renderChrome({ withToggle = true }: { withToggle?: boolean } = {}) {
  return render(
    <CartographicProvider>
      <Seed listings={[listing("layer-1", "Bike network")]} />
      {withToggle ? <CartographicMapReadingToggle /> : null}
      <CartographicLayersPanel workspaceId="ws-1" />
      <CartographicOverviewSurface>
        <a href="#a-row-on-the-page">A project on the page</a>
      </CartographicOverviewSurface>
    </CartographicProvider>
  );
}

function surface(): HTMLElement {
  const node = document.querySelector(".op-cart-surface");
  if (!(node instanceof HTMLElement)) throw new Error("The page surface did not render.");
  return node;
}

describe("reading the map uncovers it", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParams = new URLSearchParams();
    // A planner's remembered layer toggles are stored per workspace in
    // localStorage and outlive a render. Leaving them behind makes these tests
    // order-dependent — which is how this line got written: an earlier test
    // switched Bike network off, and the next one read that as the layer's
    // default.
    window.localStorage.clear();
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    delete document.body.dataset.mapReading;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete document.body.dataset.mapReading;
  });

  it("leaves the page exactly as it was until the planner asks", () => {
    renderChrome();

    expect(surface()).not.toHaveAttribute("inert");
    expect(surface()).not.toHaveAttribute("aria-hidden");
    expect(document.body.dataset.mapReading).toBeUndefined();
    expect(screen.getByRole("button", { name: "Read the map" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    // The page's own content is reachable.
    expect(screen.getByRole("link", { name: "A project on the page" })).toBeInTheDocument();
  });

  /**
   * THE CENTRAL ASSERTION. The panel leaves the focus order and the a11y tree,
   * and the layer controls do not go with it.
   */
  it("takes the page out of the way and keeps the layer controls", async () => {
    renderChrome();

    fireEvent.click(screen.getByRole("button", { name: "Read the map" }));

    expect(surface()).toHaveAttribute("inert");
    expect(surface()).toHaveAttribute("aria-hidden", "true");
    expect(document.body.dataset.mapReading).toBe("true");
    expect(screen.getByRole("button", { name: "Read the map" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Out of the a11y tree: the page's link is no longer a queryable role.
    expect(screen.queryByRole("link", { name: "A project on the page" })).not.toBeInTheDocument();

    // ...and the layers panel is untouched, still listing the workspace's own
    // layer and still able to toggle it. A mode that hid the checkboxes along
    // with the page would uncover a map the planner could no longer control.
    const checkbox = await screen.findByRole("checkbox", { name: /Bike network/ });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
    // Still inert: toggling a layer does not bring the page back.
    expect(surface()).toHaveAttribute("inert");
  });

  it("states in words that the page is hidden, and how to get it back", () => {
    renderChrome();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Hides this page so you can see your layers on the map.");

    fireEvent.click(screen.getByRole("button", { name: "Read the map" }));

    // A live region, because the change a sighted planner sees — most of the
    // screen becoming map — is the one signal a screen-reader user does not get.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Page hidden. Press Esc, or use the button, to bring it back."
    );
  });

  it("comes back from the same button", () => {
    renderChrome();

    const button = screen.getByRole("button", { name: "Read the map" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(surface()).not.toHaveAttribute("inert");
    expect(document.body.dataset.mapReading).toBeUndefined();
  });

  it("comes back on Escape, and puts focus somewhere that still exists", () => {
    renderChrome();

    fireEvent.click(screen.getByRole("button", { name: "Read the map" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(surface()).not.toHaveAttribute("inert");
    // Focus lands on the control rather than wherever it was, because wherever
    // it was may have been inside the panel that just went inert.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Read the map" }));
  });

  /**
   * LEAVING A MAP SURFACE ENDS THE MODE, BY CONSTRUCTION.
   *
   * The control mounts only inside `MapSurfaceOnly`, so navigating to the RTP
   * registry unmounts it — and its cleanup restores the page. Nothing here
   * consults a route list, which is what makes it impossible for the two to
   * disagree. Without this a planner would arrive at a records page with the
   * content gone and no control anywhere on screen to bring it back.
   */
  it("restores the page when the control leaves the screen", () => {
    const view = renderChrome();

    fireEvent.click(screen.getByRole("button", { name: "Read the map" }));
    expect(document.body.dataset.mapReading).toBe("true");

    view.rerender(
      <CartographicProvider>
        <CartographicOverviewSurface>
          <a href="#a-row-on-the-page">A project on the page</a>
        </CartographicOverviewSurface>
      </CartographicProvider>
    );

    expect(surface()).not.toHaveAttribute("inert");
    expect(document.body.dataset.mapReading).toBeUndefined();
  });

  it("mounts with no mode set even if a previous page left the attribute behind", () => {
    document.body.dataset.mapReading = "true";

    renderChrome();

    expect(document.body.dataset.mapReading).toBeUndefined();
  });
});

/**
 * "SHOW ON THE MAP" — THE OTHER END OF THE LINK.
 *
 * The library sends `/safety?layer=<id>`. This is the half that reads it back.
 * Without it the link is a navigation to a page where the planner still has to
 * find their layer's row and switch it on, which is the manual work the link
 * exists to remove.
 */
describe("arriving from a Show on the map link", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParams = new URLSearchParams();
    // A planner's remembered layer toggles are stored per workspace in
    // localStorage and outlive a render. Leaving them behind makes these tests
    // order-dependent — which is how this line got written: an earlier test
    // switched Bike network off, and the next one read that as the layer's
    // default.
    window.localStorage.clear();
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    delete document.body.dataset.mapReading;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete document.body.dataset.mapReading;
  });

  function renderArrival(listings: WorkspaceGisLayerListing[]) {
    return render(
      <CartographicProvider>
        <Seed listings={listings} />
        <CartographicLayerDeepLink />
        <CartographicMapReadingToggle />
        <CartographicLayersPanel workspaceId="ws-1" />
        <CartographicOverviewSurface>
          <a href="#a-row-on-the-page">A project on the page</a>
        </CartographicOverviewSurface>
      </CartographicProvider>
    );
  }

  it("switches the named layer on and gets the page out of the way", async () => {
    searchParams = new URLSearchParams("layer=layer-2");

    renderArrival([listing("layer-1", "Parcels"), listing("layer-2", "Bike network")]);

    const named = await screen.findByRole("checkbox", { name: /Bike network/ });
    await waitFor(() => expect(named).toBeChecked());
    expect(document.body.dataset.mapReading).toBe("true");
    expect(surface()).toHaveAttribute("inert");
  });

  /**
   * IT DOES NOT TAKE THE WHEEL. A URL parameter is an opening instruction, not
   * a standing order: a planner who brings the page back must not have it
   * snatched away again on the next render.
   */
  it("lets the planner undo it", async () => {
    searchParams = new URLSearchParams("layer=layer-1");

    renderArrival([listing("layer-1", "Bike network")]);

    await waitFor(() => expect(document.body.dataset.mapReading).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Read the map" }));

    await waitFor(() => expect(document.body.dataset.mapReading).toBeUndefined());
    // A re-render (a layer toggle, a status registration, anything) must not
    // reapply the parameter.
    fireEvent.click(await screen.findByRole("checkbox", { name: /Bike network/ }));
    await waitFor(() => expect(document.body.dataset.mapReading).toBeUndefined());
  });

  /**
   * A LINK NAMING A LAYER THIS WORKSPACE DOES NOT HAVE DOES NOTHING — it does
   * not switch on "some" layer, and it does not hide the page for a layer that
   * is not there. Stale links and hand-edited URLs both land here.
   */
  it("ignores an id that is not a layer in this workspace", async () => {
    searchParams = new URLSearchParams("layer=not-a-layer");

    renderArrival([listing("layer-1", "Bike network")]);

    const only = await screen.findByRole("checkbox", { name: /Bike network/ });
    expect(only).toBeChecked(); // its own defaultVisible, not the link's doing
    expect(document.body.dataset.mapReading).toBeUndefined();
    expect(surface()).not.toHaveAttribute("inert");
  });

  it("does nothing at all when there is no layer parameter", async () => {
    renderArrival([listing("layer-1", "Bike network")]);

    await screen.findByRole("checkbox", { name: /Bike network/ });
    expect(document.body.dataset.mapReading).toBeUndefined();
  });
});

/**
 * THE STYLESHEET HALF.
 *
 * The rendered tests above prove the control and the focus contract. They
 * cannot prove that anything moves, because jsdom loads no CSS. These read the
 * shell stylesheet — which is behind every signed-in page in the product — and
 * hold the two claims the design rests on: the panel is actually removed while
 * the mode is on, and the mode cannot reach a page that is not in it.
 */
describe("the map-reading rules in the shell stylesheet", () => {
  /*
    COMMENTS ARE STRIPPED FIRST, and it is not a formality — it was caught by
    mutation while writing this file. The block above these rules EXPLAINS the
    mode and quotes `body[data-map-reading="true"]` in its prose. Without the
    strip, a selector capture that runs from the previous rule's closing brace
    swallows that comment, and a mutation pointing the real rule at a different
    attribute value still "matched" because the paragraph about the rule said
    the right thing. The guard was reading its own explanation as evidence.
  */
  const css = stripSourceComments(
    readFileSync(path.join(process.cwd(), "src/app/cartographic.css"), "utf8")
  );

  /** Every rule whose selector mentions the mode, as [selector, body] pairs. */
  const modeRules = [...css.matchAll(/([^{}]*data-map-reading[^{}]*)\{([^}]*)\}/g)].map(
    (match) => [match[1].trim(), match[2]] as const
  );

  /**
   * THE STYLESHEET AND THE PROVIDER HAVE TO AGREE ON THE ATTRIBUTE.
   *
   * The CSS keys off `body[data-map-reading="true"]`; the provider writes
   * `document.body.dataset.mapReading`. Nothing in either file forces them to
   * match, and if they drift the mode silently does nothing at all — the button
   * presses, the panel goes inert, and the page stays exactly where it was. So
   * the value is read out of the provider's own source rather than written here
   * twice.
   */
  it("keys off the attribute the provider actually writes", () => {
    const provider = stripSourceComments(
      readFileSync(
        path.join(process.cwd(), "src/components/cartographic/cartographic-context.tsx"),
        "utf8"
      )
    );
    const written = provider.match(/body\.dataset\.mapReading\s*=\s*"([^"]+)"/);
    expect(written, "The provider no longer writes body.dataset.mapReading").toBeTruthy();
    const value = written?.[1];
    expect(modeRules.length).toBeGreaterThan(0);
    for (const [selector] of modeRules) {
      expect(selector).toContain(`data-map-reading="${value}"`);
    }
  });

  it("removes the page panel while the mode is on", () => {
    const surfaceRule = modeRules.find(([selector]) => selector.includes(".op-cart-surface"));
    expect(
      surfaceRule,
      "No rule in cartographic.css takes .op-cart-surface off the screen under " +
        'body[data-map-reading="true"]. Without it the toggle marks the panel inert and leaves ' +
        "it sitting opaquely over the map — the exact defect this mode exists to fix."
    ).toBeTruthy();

    const body = surfaceRule?.[1] ?? "";
    expect(body).toMatch(/opacity:\s*0\b/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/visibility:\s*hidden/);
  });

  /**
   * THE BLAST-RADIUS GUARD, and the reason this whole design is a mode.
   *
   * The surface is behind every signed-in page — ~20 modules, every form, every
   * table. The guarantee that none of them changed is that every rule the mode
   * introduces is scoped to an attribute no ordinary page carries. An unscoped
   * rule here would be a global change wearing this feature's name.
   */
  it("scopes every map-reading rule to the mode's own attribute", () => {
    expect(modeRules.length).toBeGreaterThan(0);
    for (const [selector] of modeRules) {
      expect(selector, `"${selector}" is not scoped to the map-reading body attribute`).toMatch(
        /body\[data-map-reading="true"\]/
      );
    }
  });

  /**
   * AND IT NEVER TOUCHES `--panel`. Restating the rejected design as an
   * assertion: if a future change makes the mode work by making the panel more
   * transparent, it has reintroduced the legibility problem this avoided.
   */
  it("changes no palette token", () => {
    for (const [selector, body] of modeRules) {
      expect(body, `"${selector}" redefines a palette token`).not.toMatch(/--panel\s*:/);
      expect(body, `"${selector}" redefines a palette token`).not.toMatch(/--muted\s*:/);
      expect(body, `"${selector}" redefines a palette token`).not.toMatch(/--ink\s*:/);
    }
  });

  it("drops the movement for planners who asked for reduced motion", () => {
    const reducedMotion = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/
    );
    expect(
      reducedMotion,
      "cartographic.css has no prefers-reduced-motion block, so the page slides away regardless " +
        "of the planner's setting."
    ).toBeTruthy();
    const block = reducedMotion?.[1] ?? "";
    expect(block).toContain("data-map-reading");
    expect(block).toMatch(/transition:\s*none/);
  });
});
