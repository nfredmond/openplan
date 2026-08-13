/**
 * CAN A PERSON ACTUALLY PRESS THIS? — the shared hit-test.
 *
 * ═══ WHY THIS IS ITS OWN MODULE ═══
 *
 * Two different questions in this harness need the same measurement:
 *
 *   · "is any control on this page covered by something?"      (overlap audit)
 *   · "is there a visible, pressable way to LEAVE this route?" (escape hatch)
 *
 * Both reduce to one question about one element: at the point a person would
 * aim at, does the browser deliver the click to this element, and can they see
 * it while they aim? Neither is answerable in the app's vitest suite. jsdom
 * loads no stylesheet, has no box model — every `getBoundingClientRect()` is
 * zero — and implements no `document.elementFromPoint`. An overlay, a
 * `pointer-events: none`, an `opacity: 0`, a `transform` that parks a fixed
 * element off the window: jsdom reports all four as a perfectly ordinary link.
 * These are browser measurements or they are nothing.
 *
 * ═══ THE SHAPE OF THE SPLIT ═══
 *
 * `sampleControls()` runs in the page and returns plain numbers. `classify()`
 * is a pure function over one of those samples and is verified by
 * `pointer-reachability.test.js` with no browser and no server. So when an audit
 * says "no reachable way off /safety", the JUDGEMENT has already been shown to
 * be able to fail; only the measurements depend on the live run.
 *
 * ═══ WHAT A SAMPLE CANNOT SEE ═══
 *
 * Colour. A link painted background-on-background is invisible to a person and
 * fully hit-testable here. Contrast is a separate check and this module does not
 * claim it. It also cannot see a control that is genuinely reachable but
 * meaningless (a link whose label lies about where it goes).
 *
 * ═══ EXPORTS (lane 1: this is the seam) ═══
 *
 *   sampleControls(page, { selector, scrollIntoView }) → Sample[]  (measures)
 *   classify(sample)                                   → Verdict   (judges, pure)
 *   inspectControls(page, options)                     → (Sample & Verdict)[]
 *   findWaysOut(page, { currentPath, ignorePathPrefixes }) → the escape-hatch question
 *   describeSample(sample)                             → one-line log string
 *
 * The overlap audit's shape is `inspectControls(page, { selector: <its wider
 * interactive list>, scrollIntoView: true })`, then filtering for
 * `hitTestable === false` and reporting `hitTopDescription` / `hitTopRoot` —
 * which is why a sample carries `disabled` and `ariaHidden` it does not itself
 * judge on. One measurement, two questions.
 */

/**
 * The smallest box a person can reasonably aim at. A 1x1 anchor is a
 * screen-reader affordance or a tracking pixel, not a door.
 */
const MIN_SIZE = 8;

/**
 * Below this, a control is a ghost: technically painted, invisible in practice.
 * `opacity: 0.05` on the rail would be as bad as `display: none` and this is the
 * only number in the module that is a judgement rather than a measurement.
 */
const MIN_OPACITY = 0.1;

/**
 * ONE ELEMENT'S MEASUREMENTS → A VERDICT. Pure; no DOM, no browser.
 *
 * The order matters for the reason string only — a sample can fail several ways
 * at once and the first stated reason is the most actionable one.
 */
function classify(sample) {
  const reasons = [];

  if (sample.display === 'none') reasons.push('display: none');
  if (sample.visibility === 'hidden' || sample.visibility === 'collapse') {
    reasons.push(`visibility: ${sample.visibility}`);
  }
  if (sample.effectiveOpacity < MIN_OPACITY) {
    reasons.push(`effective opacity ${sample.effectiveOpacity} (self or an ancestor is transparent)`);
  }
  if (sample.rect.width < MIN_SIZE || sample.rect.height < MIN_SIZE) {
    reasons.push(`${Math.round(sample.rect.width)}x${Math.round(sample.rect.height)} is too small to aim at`);
  }
  if (sample.visibleFraction <= 0) {
    reasons.push('parked outside the window');
  }

  const visible = reasons.length === 0;

  // The hit test is only meaningful where there is a point inside the window to
  // test. An element off-viewport has already failed above; saying "covered by
  // nothing" about it would be noise.
  let hitTestable = true;
  if (sample.pointerEvents === 'none') {
    reasons.push('pointer-events: none');
    hitTestable = false;
  } else if (sample.hitTopIsSelfOrDescendant === false) {
    reasons.push(`covered at its own centre by ${sample.hitTopDescription || 'another element'}`);
    hitTestable = false;
  } else if (sample.hitTopIsSelfOrDescendant === null) {
    // No point inside the window to test, or the browser found nothing there.
    // Either way this is not a control anyone can press.
    if (visible) reasons.push('the browser returned no element at its centre');
    hitTestable = false;
  }

  return {
    visible,
    hitTestable,
    reachable: visible && hitTestable,
    reason: reasons.length === 0 ? null : reasons.join('; '),
  };
}

/**
 * Measure candidate controls on a live page.
 *
 * `selector` is applied in the page. Everything returned is JSON — no handles —
 * so a caller can log a sample verbatim into an evidence record.
 */
async function sampleControls(
  page,
  { selector = 'a[href], button, [role="link"], [role="button"]', scrollIntoView = false } = {},
) {
  return page.evaluate(({ sel, scroll }) => {
    /** Opacity is multiplicative up the tree; getComputedStyle only reports one node's. */
    function effectiveOpacity(node) {
      let value = 1;
      let cursor = node;
      while (cursor && cursor.nodeType === 1) {
        const raw = Number(window.getComputedStyle(cursor).opacity);
        value *= Number.isFinite(raw) ? raw : 1;
        cursor = cursor.parentElement;
      }
      return Math.round(value * 1000) / 1000;
    }

    function describe(node) {
      if (!node || node.nodeType !== 1) return null;
      const id = node.id ? `#${node.id}` : '';
      const cls = typeof node.className === 'string' && node.className.trim()
        ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
      return `${node.tagName.toLowerCase()}${id}${cls}`;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };

    /**
     * WHAT A SCROLLING PANEL IS ACTUALLY SHOWING OF THIS BOX (lane 1, from a
     * live run). `getBoundingClientRect` is not clipped by an ancestor's
     * overflow, so a card scrolled half out of the content panel still reports
     * its whole box — with a centre point below the panel's edge, sitting over
     * the map behind it. Aiming there measures a place the panel is not
     * painting and blames whatever the map put underneath. The point a person
     * can press is the centre of what is left after every clipping ancestor and
     * the window have had their say.
     */
    function clipToAncestors(node, box) {
      let left = box.left;
      let top = box.top;
      let right = box.left + box.width;
      let bottom = box.top + box.height;
      for (let cursor = node.parentElement; cursor; cursor = cursor.parentElement) {
        const style = window.getComputedStyle(cursor);
        const clips = /(auto|scroll|hidden|clip)/.test(style.overflowY) || /(auto|scroll|hidden|clip)/.test(style.overflowX);
        if (!clips) continue;
        const panel = cursor.getBoundingClientRect();
        left = Math.max(left, panel.left);
        top = Math.max(top, panel.top);
        right = Math.min(right, panel.right);
        bottom = Math.min(bottom, panel.bottom);
      }
      return { left, top, right, bottom };
    }

    /** The outermost non-body ancestor of whatever is covering — names the panel, not the span. */
    function blockerRoot(node) {
      let cursor = node;
      while (cursor && cursor.parentElement && cursor.parentElement !== document.body) {
        cursor = cursor.parentElement;
      }
      return describe(cursor);
    }

    return Array.from(document.querySelectorAll(sel)).map((node, index) => {
      // Optional, and OFF by default. A control below the fold has no meaningful
      // centre point until a person scrolls to it, so an overlap audit wants
      // this. The escape-hatch question does not: a door a planner must scroll
      // to find on a full-screen map is not the door being asserted.
      //
      // A WARNING ABOUT `scroll: true`, paid for in a live run (lane 1).
      // Centring a control before hit-testing it hides the very defect an
      // overlap audit is looking for: a control is only ever pressed where it
      // happens to be resting, and the floating chrome lives at the bottom of
      // the window, so a control that is always measured in the middle is never
      // measured where it collides. The overlap audit therefore does NOT use
      // this flag — it sweeps the page's own scroll positions and measures
      // whatever is on screen at each one (openplan-local-control-hit-test-
      // audit.js). Both mutations of the shell's safe area survived a run that
      // used this flag, and both were caught the moment it stopped.
      if (scroll) {
        const first = node.getBoundingClientRect();
        const cy = first.top + first.height / 2;
        const cx = first.left + first.width / 2;
        if (cy < 0 || cy > window.innerHeight || cx < 0 || cx > window.innerWidth) {
          node.scrollIntoView({ block: 'center', inline: 'center' });
        }
      }

      const style = window.getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const rect = { left: box.left, top: box.top, width: box.width, height: box.height };

      // AIM AT A LINE, NOT AT THE UNION OF LINES (lane 1, from a live run).
      //
      // `getBoundingClientRect` on an inline element that wraps returns the box
      // around ALL of its line boxes — and the centre of that box is the gap
      // between line one and line two, where the browser correctly reports the
      // PARENT. A project link in a table read as "covered by its own <td>".
      // The line boxes are `getClientRects()`; a person aims at the longest
      // one. A block-level control has exactly one, so nothing changes for it.
      const lines = Array.from(node.getClientRects());
      const aimBox = lines.length
        ? lines.reduce((best, line) => (line.width * line.height > best.width * best.height ? line : best))
        : box;

      // The part of the box actually inside the window AND inside every panel
      // that clips it; the aim point must be in there or a person could not put
      // a cursor on it.
      const shown = clipToAncestors(node, aimBox);
      const left = Math.max(0, shown.left);
      const top = Math.max(0, shown.top);
      const right = Math.min(viewport.width, shown.right);
      const bottom = Math.min(viewport.height, shown.bottom);
      const visibleWidth = Math.max(0, right - left);
      const visibleHeight = Math.max(0, bottom - top);
      // Of the line being aimed at, not of the union — the two are the same box
      // for everything except a wrapped inline.
      const area = aimBox.width * aimBox.height;
      const visibleFraction = area > 0 ? (visibleWidth * visibleHeight) / area : 0;

      let hitTopIsSelfOrDescendant = null;
      let hitTopDescription = null;
      let hitTopRoot = null;
      let aim = null;
      if (visibleWidth > 0 && visibleHeight > 0) {
        aim = { x: left + visibleWidth / 2, y: top + visibleHeight / 2 };
        const top_ = document.elementFromPoint(aim.x, aim.y);
        hitTopDescription = describe(top_);
        hitTopIsSelfOrDescendant = top_ ? node === top_ || node.contains(top_) : null;
        // An ANCESTOR at the point is still "covered": the only way the browser
        // returns a wrapper instead of the control is if the control itself is
        // transparent to hit-testing. Naming the wrapper is more useful than
        // passing silently.
        if (top_ && !hitTopIsSelfOrDescendant) hitTopRoot = blockerRoot(top_);
      }

      const href = node.getAttribute('href');
      return {
        index,
        selector: describe(node),
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        ariaLabel: node.getAttribute('aria-label'),
        href,
        resolvedHref: node instanceof HTMLAnchorElement ? node.href : null,
        rect,
        aim,
        visibleFraction: Math.round(visibleFraction * 1000) / 1000,
        display: style.display,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        effectiveOpacity: effectiveOpacity(node),
        hitTopIsSelfOrDescendant,
        hitTopDescription,
        hitTopRoot,
        disabled: node.disabled === true,
        ariaHidden: node.getAttribute('aria-hidden') === 'true',
        viewport,
      };
    });
  }, { sel: selector, scroll: scrollIntoView });
}

/** Measure, then judge. */
async function inspectControls(page, options = {}) {
  const samples = await sampleControls(page, options);
  return samples.map((sample) => ({ ...sample, ...classify(sample) }));
}

/**
 * CAN A PERSON LEAVE THIS ROUTE?
 *
 * Every same-origin link whose path differs from where we are. Not buttons: a
 * button may or may not navigate and only a click would tell, whereas an
 * anchor's destination is written on it. `#`-only and `javascript:` hrefs are
 * not doors.
 *
 * Returns every candidate WITH its verdict, so a caller can report the ones that
 * exist-but-are-unreachable — which is the interesting failure. A route with no
 * candidates at all and a route whose only candidate is under an overlay look
 * identical from the outside and are different defects.
 */
async function findWaysOut(page, { currentPath, ignorePathPrefixes = [] } = {}) {
  const here = currentPath || new URL(page.url()).pathname;
  const controls = await inspectControls(page, { selector: 'a[href]' });
  const origin = new URL(page.url()).origin;

  return controls.filter((control) => {
    if (!control.resolvedHref) return false;
    let target;
    try {
      target = new URL(control.resolvedHref);
    } catch {
      return false;
    }
    if (target.origin !== origin) return false;
    if (target.pathname === here) return false;
    if (ignorePathPrefixes.some((prefix) => target.pathname.startsWith(prefix))) return false;
    return true;
  });
}

function describeSample(sample) {
  const label = sample.ariaLabel || sample.text || sample.selector;
  const where = `${Math.round(sample.rect.left)},${Math.round(sample.rect.top)} ` +
    `${Math.round(sample.rect.width)}x${Math.round(sample.rect.height)}`;
  const verdict = sample.reachable ? 'reachable' : `UNREACHABLE (${sample.reason})`;
  return `${label || '(no label)'} → ${sample.href || '—'} [${where}] ${verdict}`;
}

module.exports = {
  MIN_SIZE,
  MIN_OPACITY,
  classify,
  sampleControls,
  inspectControls,
  findWaysOut,
  describeSample,
};
