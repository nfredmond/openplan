/**
 * Keeps a Mapbox map the size of the element it was mounted into.
 *
 * WHY THIS EXISTS. Mapbox measures its container ONCE, at construction, and
 * never again unless something calls `map.resize()`. That was harmless while
 * every map on a detail page was on screen the moment the page rendered. It
 * stopped being harmless when four detail pages were split into URL tabs: a
 * closed panel is still rendered and still mounts its client components, it is
 * merely `display: none`, so a map inside one is built against a container
 * measuring 0x0. Opening that tab gives the container a size but tells the map
 * nothing — the canvas stays 0x0 and the planner gets a blank rectangle where
 * the map is.
 *
 * A `ResizeObserver` on the container is the fix that does not need every
 * caller to know why: the browser reports the box changing from 0x0 to its real
 * size the moment the tab opens, and every later change (window resize, a
 * sidebar collapsing, print) arrives through the same channel.
 *
 * HOW TO USE IT. Call it in the same effect that constructs the map, right
 * after construction, and call the returned teardown from that effect's
 * cleanup — before `map.remove()`, so nothing is measuring a removed map:
 *
 *     const map = new mapboxgl.Map({ container, ... });
 *     const stopSizing = keepMapSizedToContainer(map, container);
 *     return () => { stopSizing(); map.remove(); };
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not resize on a zero-sized box.
 * Mapbox reads 0x0 as a legitimate size and will throw away its drawing buffer,
 * so resizing a hidden container costs a full re-render when it comes back
 * without buying anything — nobody can see a hidden map being the wrong size.
 */
export function keepMapSizedToContainer(
  map: { resize: () => void },
  container: Element,
): () => void {
  // jsdom has no ResizeObserver and no box model, and a server render has
  // neither. Both are environments where there is nothing to keep sized.
  if (typeof ResizeObserver === "undefined") {
    return () => {};
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.contentRect;
      if (box.width === 0 || box.height === 0) continue;
      map.resize();
    }
  });

  observer.observe(container);
  return () => observer.disconnect();
}
