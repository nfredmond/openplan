import * as React from "react";

import { OperatorDetail } from "@/components/ui/read-failure-notice";
import { cn } from "@/lib/utils";

/**
 * A MAP THAT CANNOT DRAW BECAUSE NO MAP KEY IS SET.
 *
 * Six staff maps printed `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` in the sentence a
 * planner reads (two-month review, October 12, 2026, finding 2). The Safety
 * map already had the right shape: what is off, what still works, who can fix
 * it, and the variable folded away for that person. This is that shape, shared.
 */

/** The planner's line. The second sentence is the move they can make. */
export const MAP_UNAVAILABLE_SENTENCE =
  "This installation has no map key set up, so the map cannot be drawn. Whoever runs this OpenPlan can add one.";

/** The planner's line when the map is set up but this browser could not start it. */
export const MAP_CANNOT_START_SENTENCE = "This browser could not start the map.";

/**
 * Why there is no map. `not_set_up`: no key and no open style. `cannot_start`:
 * the library failed in this browser, usually for want of WebGL.
 */
export type MapUnavailableCause = "not_set_up" | "cannot_start";

/**
 * `stillWorks` says what on the page is unaffected, so an empty map is not
 * read as missing data. `children` carries any further planner line a surface
 * needs (for example, how many records would be drawn).
 */
export function MapUnavailableNotice({
  title = "The map can't be drawn here",
  stillWorks,
  unusableToken = false,
  cause = "not_set_up",
  className,
  testId,
  children,
}: {
  title?: string;
  stillWorks?: string;
  unusableToken?: boolean;
  cause?: MapUnavailableCause;
  className?: string;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[0.5rem] border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground",
        className
      )}
      role="status"
      data-testid={testId}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1.5">
        {cause === "cannot_start" ? MAP_CANNOT_START_SENTENCE : MAP_UNAVAILABLE_SENTENCE}
        {stillWorks ? ` ${stillWorks}` : ""}
      </p>
      {children}
      <OperatorDetail>
        {/* Written inline, inside the disclosure, so the build-notes guard can
            see that this is where the variable name lives. */}
        {cause === "cannot_start" ? (
          <p>
            The map library did not start in this browser. MapLibre needs WebGL2 and Mapbox needs
            WebGL; either may be turned off or unsupported. The browser console holds the exact error.
          </p>
        ) : (
          <p>
            {unusableToken
              ? "A Mapbox token is set but is not a public key. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a token beginning with pk. and rebuild. A secret sk. token is refused rather than sent to the browser."
              : "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and rebuild."}{" "}
            {/* Only maps built through src/lib/maps/map-engine.ts can use the open style. */}
            Maps that can draw without a key use a MapLibre style named in
            NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL instead; see docs/SELF_HOSTING.md.
          </p>
        )}
      </OperatorDetail>
    </div>
  );
}
