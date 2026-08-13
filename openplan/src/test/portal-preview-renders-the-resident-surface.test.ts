/**
 * THE OPERATOR PREVIEW MUST RENDER THE PAGE RESIDENTS GET — checked against the
 * public route, not against a name written here.
 *
 * ============================================================================
 * THE DEFECT THIS EXISTS FOR
 * ============================================================================
 *
 * `/engagement/<id>/preview` is the one surface where an operator reads their
 * own consultation the way a member of the public will. Its docstring promised
 * it rendered "the REAL component rather than a mockup that could drift from
 * it" — and then the public route was rebuilt around `PublicMapShell` while the
 * preview kept rendering `PublicEngagementPortal`. For an entire release the
 * preview showed a page no resident could reach: an operator could sign off on
 * a layout, a reading order and a set of controls that were not the ones being
 * published. Nothing failed, because the promise lived in a comment.
 *
 * ============================================================================
 * WHY THE PUBLIC ROUTE IS THE SOURCE OF TRUTH HERE
 * ============================================================================
 *
 * A test that asserted "the preview renders PublicMapShell" would be the same
 * promise in a second place: the next redesign moves the public route to a
 * third component, edits this line, and the preview drifts again with the suite
 * green. So the resident surface is DERIVED — it is whatever component the
 * PUBLIC route spreads its shell props into — and the preview is required to
 * name that same thing. Renaming or replacing the resident surface fails this
 * test until the preview follows.
 *
 * ============================================================================
 * WHAT THIS FILE CANNOT PROVE
 * ============================================================================
 *
 * It reads source; it renders nothing. That the preview actually mounts the
 * surface, and that its submission controls are inert, is proved by rendering
 * in `engagement-portal-preview-page.test.tsx`. Source alone also cannot show
 * that the two routes pass the same VALUES — that is what the shared builder is
 * for, and the third case below is what stops either route from quietly
 * computing its own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

const SRC = path.join(process.cwd(), "src");

const PUBLIC_ROUTE = "app/(portal)/engage/[shareToken]/page.tsx";
const PREVIEW_ROUTE = "app/(app)/engagement/[campaignId]/preview/page.tsx";
const PUBLIC_CONTEXT_ROUTE = "app/(portal)/engage/[shareToken]/about/page.tsx";
const PREVIEW_CONTEXT_ROUTE = "app/(app)/engagement/[campaignId]/preview/about/page.tsx";

/** Source with every comment blanked — a paragraph ABOUT the code is not the code. */
function code(relative: string): string {
  return stripSourceComments(readFileSync(path.join(SRC, relative), "utf8"));
}

/**
 * The component a route spreads a given props object into — i.e. the surface
 * that route actually renders.
 *
 * Found by the spread rather than by "the first engagement component imported":
 * routes import several (a language picker, an accessibility notice), and only
 * one of them is handed the page.
 */
function surfaceRenderedWith(source: string, builder: string): string | null {
  const match = new RegExp(`<([A-Z]\\w+)\\s+\\{\\.\\.\\.${builder}\\}`).exec(source);
  return match?.[1] ?? null;
}

describe("the operator preview renders what residents get", () => {
  it("names the same resident surface the public route does", () => {
    const publicRoute = code(PUBLIC_ROUTE);
    const preview = code(PREVIEW_ROUTE);

    const residentSurface = surfaceRenderedWith(publicRoute, "shellProps");
    expect(
      residentSurface,
      `${PUBLIC_ROUTE} no longer spreads shell props into a component — the surface cannot be derived, so this guard cannot see drift. Re-point it at whatever the public route now renders.`
    ).not.toBeNull();

    expect(
      surfaceRenderedWith(preview, "shellProps"),
      `${PREVIEW_ROUTE} must render <${residentSurface}>, the same surface residents get`
    ).toBe(residentSurface);
  });

  it("builds its props with the shared builder rather than computing its own", () => {
    /*
      The same component with props assembled twice is the same defect one step
      later: the door's label, which backgrounds are offered, whether the map is
      available at all and which comments count as top-level are all decisions,
      and two copies of a decision are two answers waiting to differ.
    */
    for (const relative of [PUBLIC_ROUTE, PREVIEW_ROUTE]) {
      expect(code(relative), `${relative} must build its props with buildPortalMapShellProps`).toMatch(
        /buildPortalMapShellProps\(/
      );
    }
  });

  it("writes nothing: the preview surface is mounted in preview mode", () => {
    // The prop that makes every submission control inert. Without it an
    // operator reading their own consultation can put a row in their own public
    // record, which is the one thing a preview must never do.
    expect(code(PREVIEW_ROUTE)).toMatch(/previewMode\b/);
    expect(code(PREVIEW_CONTEXT_ROUTE)).toMatch(/previewMode\b/);
  });

  it("sends the one door somewhere an operator can actually go", () => {
    /*
      The resident's surface offers exactly one way onward. On the public side
      it is `/engage/<token>/about`; the preview CANNOT borrow that, because a
      draft campaign has no reachable public page and the only link on the
      preview would 404 on precisely the campaigns the preview exists for. So
      the preview's door points inside the console, and that page exists.
    */
    const preview = code(PREVIEW_ROUTE);
    expect(preview).not.toMatch(/detailsHref=\{[^}]*\/engage\//);
    expect(preview).toMatch(/preview\/about/);
  });

  it("renders the context page from the same component on both sides of the door", () => {
    /*
      Same argument as the map surface, applied to what is behind it: the
      survey, the feed, the close-the-loop record and the subscribe form. Also
      derived — the context surface is whatever component the PUBLIC context
      route hands the loaded bundle to.
    */
    const contextSurface = /<([A-Z]\w+)[\s\S]{0,200}?bundle=\{bundle\}/.exec(
      code(PUBLIC_CONTEXT_ROUTE)
    )?.[1];
    expect(
      contextSurface,
      `${PUBLIC_CONTEXT_ROUTE} no longer hands its bundle to a component — the context surface cannot be derived`
    ).toBeTruthy();

    expect(
      code(PREVIEW_CONTEXT_ROUTE),
      `${PREVIEW_CONTEXT_ROUTE} must render <${contextSurface}>`
    ).toMatch(new RegExp(`<${contextSurface}\\b`));
  });
});
