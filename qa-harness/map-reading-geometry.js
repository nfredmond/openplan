/**
 * HOW MUCH OF THE WINDOW IS ACTUALLY MAP.
 *
 * ═══ WHY THIS IS ITS OWN MODULE ═══
 *
 * The claim that started this work — "an uploaded layer is only visible in the
 * margins" — is a claim about LAYOUT, and layout is the one thing the app's
 * jsdom test suite cannot see: jsdom has no box model, so every rect it reports
 * is zero. Only a real browser can measure it.
 *
 * But a browser check that nobody can run is not evidence either, and this
 * repository's rule is that a test which could not have failed is not proof. So
 * the ARITHMETIC lives here, as a pure function over rectangles, and is verified
 * against fixtures by `map-reading-geometry.test.js` with no browser and no
 * running app. `openplan-local-map-reading-audit.js` supplies the real rectangles
 * from a real page and applies the same function.
 *
 * The split is deliberate: when the audit reports 14%, the number itself has
 * already been shown to be computed correctly, and the only thing resting on the
 * live run is where the rectangles came from.
 */

/**
 * Area of a rectangle's overlap with the viewport, in square pixels.
 *
 * Rects are clipped to the viewport first, because the shell's fixed panels can
 * extend past the window edge and off-screen pixels cover nothing.
 */
function visibleArea(rect, viewport) {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function intersectionArea(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/**
 * The fraction of the viewport where the map is not behind an opaque panel.
 *
 * OVERLAPS ARE SUBTRACTED PAIRWISE, which matters: the shell's panels are laid
 * out not to overlap (the map dock is a flex column precisely so the legend
 * cannot sit on the layers panel), so summing their areas is right in the layout
 * this measures — and pairwise correction keeps the answer from going negative
 * if a future layout does overlap them. It does not correct triple overlaps; the
 * result would be a slight OVERSTATEMENT of covered area, which errs toward
 * reporting less map than there is. Erring in that direction is correct for a
 * check whose job is to prove there is enough.
 *
 * A panel that is `visibility: hidden`, `display: none` or zero-sized should not
 * be passed in at all — the caller decides what counts as covering, because only
 * the caller can see computed styles.
 */
function uncoveredMapFraction({ viewport, covering }) {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) return 0;

  let covered = 0;
  for (let i = 0; i < covering.length; i += 1) {
    covered += visibleArea(covering[i], viewport);
    for (let j = 0; j < i; j += 1) {
      covered -= intersectionArea(
        clipToViewport(covering[i], viewport),
        clipToViewport(covering[j], viewport),
      );
    }
  }

  const uncovered = Math.max(0, viewportArea - covered);
  return uncovered / viewportArea;
}

function clipToViewport(rect, viewport) {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

module.exports = { uncoveredMapFraction, visibleArea, intersectionArea };
