import Link from "next/link";
import { AlertTriangle, MapPinned } from "lucide-react";

import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  describeCorroborationBaseline,
  UNMEASURED_COMMENTS_CAVEAT,
  type CampaignCrashCorroboration,
  type CommentCrashRecord,
} from "@/lib/engagement/crash-corroboration";

/**
 * WHAT RESIDENTS MAPPED, BESIDE WHERE COLLISIONS WERE REPORTED.
 *
 * The panel a planner assembles SS4A evidence from, and the three things it is
 * careful about — each one a way this screen could mislead someone who cannot
 * check it:
 *
 * 1. IT NEVER SAYS "CONFIRMED". Proximity is not aboutness: a comment asking
 *    for a bench sits in the same 100 m as that corner's collisions. The panel
 *    puts the resident's words and the collision counts side by side and lets a
 *    planner make the call, because a judgement rendered as a green tick is one
 *    nobody re-examines.
 * 2. THE BASELINE IS ABOVE THE LIST, NOT BURIED UNDER IT. In a dense area
 *    almost every point has collisions nearby — a probe at one real Sacramento
 *    corner returned 258 within 100 m. Reading "12 collisions" without the
 *    campaign's own distribution turns ordinary city geography into a finding.
 * 3. UNMEASURED COMMENTS ARE LISTED SEPARATELY AND NEVER AS ZEROS. A resident
 *    who flagged a dangerous corner in a county nobody has acquired crash data
 *    for must not appear on a screen that reads as the
 *    collision history contradicting them.
 */

export type CrashRadiusChoice = {
  meters: number;
  href: string;
  active: boolean;
};

export type CrashCorroborationPanelProps = {
  summary: CampaignCrashCorroboration | null;
  /** True when the spatial read itself failed — never rendered as "nothing found". */
  unreadable: boolean;
  radiusChoices: readonly CrashRadiusChoice[];
  /** Mapped comments excluded because they are not approved yet, from the campaign's own counts. */
  unmoderatedMappedCount: number;
  /** Deep link into the moderation queue, so the nudge in 4 is actionable. */
  moderationHref: string;
};

/** How many collision-carrying comments the list shows before it summarizes the rest. */
const VISIBLE_ITEM_LIMIT = 25;

function CommentRow({ item }: { item: CommentCrashRecord }) {
  const harm = item.killed > 0 || item.severeInjury > 0;
  return (
    <div className="module-record-row" data-testid={`crash-corroboration-item-${item.itemId}`}>
      <div className="module-record-main">
        <div className="module-record-head">
          <p className="module-record-title">{item.snippet}</p>
          {item.coverage === "not_acquired" ? (
            <StatusBadge tone="neutral">Not measured here</StatusBadge>
          ) : item.crashTotal === 0 ? (
            <StatusBadge tone="neutral">None nearby</StatusBadge>
          ) : (
            <StatusBadge tone={harm ? "danger" : "warning"}>
              {item.crashTotal} nearby
            </StatusBadge>
          )}
        </div>
        <p className="module-record-summary">{item.sentence}</p>
        <div className="module-record-meta">
          {item.nearestMeters !== null ? (
            <span className="module-record-chip">Nearest {item.nearestMeters} m</span>
          ) : null}
          {item.votes > 0 ? <span className="module-record-chip">{item.votes} votes</span> : null}
          {/* The instrument that bounds the reading, shown only when it is not
              the full one — a caveat that fires on every row is one nobody reads. */}
          {item.weakestSeverityCompleteness === "fatal_only" ? (
            <span className="module-record-chip">Fatal collisions only at this location</span>
          ) : item.weakestSeverityCompleteness === "fatal_injury_only" ? (
            <span className="module-record-chip">Serious-injury detail unavailable here</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CrashCorroborationPanel({
  summary,
  unreadable,
  radiusChoices,
  unmoderatedMappedCount,
  moderationHref,
}: CrashCorroborationPanelProps) {
  const withCrashes = (summary?.items ?? []).filter(
    (item) => item.coverage === "covered" && item.crashTotal > 0
  );
  const quiet = (summary?.items ?? []).filter(
    (item) => item.coverage === "covered" && item.crashTotal === 0
  );
  const unmeasured = (summary?.items ?? []).filter((item) => item.coverage === "not_acquired");
  const baseline = summary ? describeCorroborationBaseline(summary) : null;

  return (
    <article className="module-section-surface" id="crash-corroboration">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Engagement × safety</p>
          <h2 className="module-section-title">
            What residents mapped, and where collisions have been reported
          </h2>
          <p className="module-section-description">
            For every mapped comment, the reported collisions near that same place. This is
            proximity, not cause: a comment is not established as being about the collisions
            beside it, and deciding that is your call, not the software&apos;s.
          </p>
        </div>
      </div>

      {unreadable ? (
        <div className="mt-5">
          <StateBlock
            tone="danger"
            title="The reported collisions could not be read for this campaign"
            description="No comparison is shown rather than a comparison of zero. Nothing here says these locations are without collisions."
            compact
          />
        </div>
      ) : !summary || summary.mappedTotal === 0 ? (
        <div className="mt-5">
          <StateBlock
            tone="neutral"
            title="No approved comment on this campaign has a location yet"
            description="This comparison needs comments placed on the map. Approved comments without a pin cannot be matched to a place, and are not counted here."
            compact
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2" data-testid="crash-radius-choices">
            <span className="module-record-chip">Distance from each pin</span>
            {radiusChoices.map((choice) => (
              <Link
                key={choice.meters}
                href={choice.href}
                className="module-record-chip"
                aria-current={choice.active ? "true" : undefined}
                data-active={choice.active ? "true" : "false"}
              >
                {choice.meters} m
              </Link>
            ))}
          </div>

          {baseline ? (
            <StateBlock
              tone="info"
              title="Read any one number against this campaign's own spread"
              description={baseline}
              compact
            />
          ) : null}

          {withCrashes.length > 0 ? (
            <div className="module-record-list" data-testid="crash-corroboration-list">
              {withCrashes.slice(0, VISIBLE_ITEM_LIMIT).map((item) => (
                <CommentRow key={item.itemId} item={item} />
              ))}
              {withCrashes.length > VISIBLE_ITEM_LIMIT ? (
                <p className="module-note">
                  {withCrashes.length - VISIBLE_ITEM_LIMIT} further mapped comments also have
                  collisions within {summary.radiusMeters} m. The list is ordered by people
                  killed, then people injured, then collision count.
                </p>
              ) : null}
            </div>
          ) : summary.coveredTotal > 0 ? (
            <p className="module-empty-state">
              No mapped comment inside crash coverage has a collision within{" "}
              {summary.radiusMeters} m.
            </p>
          ) : (
            // NOT "none of them has a collision" — none of them was CHECKED.
            // With nothing inside coverage there is no comparison to report at
            // all, and a sentence about what was not found would imply a search
            // that never ran. The unmeasured block below carries the whole story.
            <p className="module-empty-state" data-testid="crash-corroboration-nothing-covered">
              None of this campaign&apos;s mapped comments sits inside a completed crash
              acquisition, so there is no comparison to show yet.
            </p>
          )}

          {quiet.length > 0 ? (
            <p className="module-note" data-testid="crash-corroboration-quiet">
              {quiet.length} further mapped comment{quiet.length === 1 ? " sits" : "s sit"} inside
              crash coverage with no reported collision within {summary.radiusMeters} m. That is a
              reading, and a real one.
            </p>
          ) : null}

          {unmeasured.length > 0 ? (
            <div data-testid="crash-corroboration-unmeasured">
              <StateBlock
                tone="warning"
                title={`${unmeasured.length} mapped comment${
                  unmeasured.length === 1 ? " sits" : "s sit"
                } where no crash data has been acquired`}
                description="Nobody has retrieved collisions for these locations, so nothing can be said about them either way. They are not places where no collision happened, and nothing here contradicts what those residents reported. Retrieve crash data covering them in Safety to include them."
                compact
              />
            </div>
          ) : null}

          {unmoderatedMappedCount > 0 ? (
            <p className="module-note" data-testid="crash-corroboration-unmoderated">
              <MapPinned className="mr-1 inline h-3 w-3" />
              {unmoderatedMappedCount} mapped comment
              {unmoderatedMappedCount === 1 ? " is" : "s are"} still awaiting moderation and is not
              in this comparison.{" "}
              <Link href={moderationHref} className="underline">
                Review the queue
              </Link>
              .
            </p>
          ) : null}

          {summary.caveats.length > 0 ? (
            <div className="space-y-1" data-testid="crash-corroboration-caveats">
              {summary.caveats
                // Not repeated under the block that already names the count.
                .filter((caveat) => !(unmeasured.length > 0 && caveat === UNMEASURED_COMMENTS_CAVEAT))
                .map((caveat) => (
                  <p key={caveat} className="module-note">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {caveat}
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
