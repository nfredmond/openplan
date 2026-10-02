"use client";

import { useEffect } from "react";

/**
 * Marks a page whose own content should fill the page area with no padding.
 *
 * Corridor Analysis is a map with a docked sidebar. Inside the shell's normal
 * page padding it drew as a bordered, rounded box floating in the middle of the
 * page: a frame around the one page that is supposed to be a map. Mounting this
 * removes the padding (see "PAGES THAT RUN TO THE EDGE" in cartographic.css) so
 * the map meets the rail, the header and the window edge.
 *
 * It does not float the rail or the header over the map the way Safety's
 * full-bleed mode does; the plain shell stays exactly as it is on other pages.
 */
export function PageRunsToTheEdge() {
  useEffect(() => {
    document.body.dataset.pageFlush = "true";
    return () => {
      delete document.body.dataset.pageFlush;
    };
  }, []);

  return null;
}
