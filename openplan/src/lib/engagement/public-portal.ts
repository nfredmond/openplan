import { calendarDayOf, UTC_TIME_ZONE, wallClockTimeOf } from "@/lib/time/workspace-calendar";

export type PublicPortalCampaignLike = {
  status?: string | null;
  share_token?: string | null;
  public_description?: string | null;
  allow_public_submissions?: boolean | null;
  submissions_closed_at?: string | null;
  participation_starts_at?: string | null;
  participation_ends_at?: string | null;
};

/** The clock and calendar a staff sentence about participation dates is written in. */
export type PortalClockOptions = {
  now?: Date;
  /** The workspace's IANA zone (`loadWorkspaceCalendar`). Absent means UTC, and the sentence says so. */
  timeZone?: string;
};

/**
 * Why the participation dates keep comments closed right now, or null when
 * they do not.
 *
 * The comparison is the one the public page, the submit routes and the
 * database triggers make: closed before the start, and closed from the end
 * instant on. Staff copy reads this so the console cannot say "accepting
 * submissions" while the public page refuses them.
 */
export function participationDateClosure(
  campaign: Pick<PublicPortalCampaignLike, "participation_starts_at" | "participation_ends_at">,
  options: PortalClockOptions = {}
): { reason: "not_started" | "ended"; sentence: string } | null {
  const now = (options.now ?? new Date()).getTime();
  const timeZone = options.timeZone ?? UTC_TIME_ZONE;
  const starts = campaign.participation_starts_at;
  const ends = campaign.participation_ends_at;

  if (starts && Date.parse(starts) > now) {
    const moment = recordedMoment(starts, timeZone);
    return {
      reason: "not_started",
      sentence: moment
        ? `Comments open on ${moment}, when the participation period starts.`
        : "Comments open when the participation period starts.",
    };
  }
  if (ends && Date.parse(ends) <= now) {
    const moment = recordedMoment(ends, timeZone);
    return {
      reason: "ended",
      sentence: moment
        ? `Comments are closed because the participation period ended on ${moment}.`
        : "Comments are closed because the participation period has ended.",
    };
  }
  return null;
}

/** "October 10, 2026 at 16:00 (America/Los_Angeles)", in the workspace calendar. Null when unreadable. */
function recordedMoment(value: string, timeZone: string): string | null {
  const day = calendarDayOf(value, timeZone);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  // The day is already the workspace's; format it as a plain calendar day.
  const longDay = new Intl.DateTimeFormat("en-US", {
    timeZone: UTC_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date)));
  const time = wallClockTimeOf(value, timeZone);
  return time ? `${longDay} at ${time} (${timeZone})` : longDay;
}

export type PublicPortalReadinessCheck = {
  id: "share_token" | "active_status" | "public_description" | "submission_mode" | "map_opens_somewhere";
  label: string;
  passed: boolean;
  detail: string;
};

export type PublicPortalReadiness = {
  label: "Ready to share" | "Needs setup";
  completeCount: number;
  totalChecks: number;
  checks: PublicPortalReadinessCheck[];
  nextAction: string;
};

export type PublicPortalState = {
  shareToken: string | null;
  portalPath: string | null;
  visibility: "private" | "staged" | "live_open" | "live_closed";
  label: string;
  /** Compact one-word form for chips and list rows: Private / Staged / Live. */
  shortLabel: "Private" | "Staged" | "Live";
  detail: string;
  isPubliclyReachable: boolean;
  isAcceptingSubmissions: boolean;
};

/**
 * Server-minted share tokens: 28 characters over a 36-character lowercase
 * alphanumeric alphabet ≈ 144 bits of entropy — unguessable, URL-safe, and
 * already in `normalizeShareToken` canonical form (no case to lose).
 */
export const PUBLIC_SHARE_TOKEN_LENGTH = 28;

const SHARE_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Mint a crypto-strong public share token. Uses rejection sampling so every
 * character is uniformly likely (a plain modulo would bias toward the start of
 * the alphabet). Collisions against the UNIQUE `share_token` column are
 * practically impossible at this entropy, but callers still handle the
 * constraint honestly instead of assuming.
 */
export function mintPublicShareToken(length: number = PUBLIC_SHARE_TOKEN_LENGTH): string {
  // Largest multiple of the alphabet size that fits in a byte; bytes at or
  // above it are rejected so the modulo stays unbiased.
  const rejectionThreshold = Math.floor(256 / SHARE_TOKEN_ALPHABET.length) * SHARE_TOKEN_ALPHABET.length;
  const characters: string[] = [];

  while (characters.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= rejectionThreshold) continue;
      characters.push(SHARE_TOKEN_ALPHABET[byte % SHARE_TOKEN_ALPHABET.length]);
      if (characters.length === length) break;
    }
  }

  return characters.join("");
}

export function normalizeShareToken(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function buildPublicPortalPath(shareToken: string | null | undefined): string | null {
  const normalized = normalizeShareToken(shareToken);
  return normalized ? `/engage/${encodeURIComponent(normalized)}` : null;
}

export function getPublicPortalState(
  campaign: PublicPortalCampaignLike,
  options: PortalClockOptions = {}
): PublicPortalState {
  const shareToken = normalizeShareToken(campaign.share_token);
  const portalPath = buildPublicPortalPath(shareToken);

  if (!shareToken) {
    return {
      shareToken: null,
      portalPath: null,
      visibility: "private",
      label: "Private",
      shortLabel: "Private",
      detail: "No share token is configured yet, so the public engagement page is offline.",
      isPubliclyReachable: false,
      isAcceptingSubmissions: false,
    };
  }

  if (campaign.status === "closed") {
    // The link still answers, with a notice and nothing else. That is not
    // "publicly reachable" in the sense every reader of this state means (the
    // campaign's page and its comments), so the flag stays false and the
    // detail says exactly what a person who opens the link sees.
    return {
      shareToken,
      portalPath,
      visibility: "staged",
      label: "Closed · notice only",
      shortLabel: "Staged",
      detail:
        "This campaign is closed. The share link now shows only a notice that the comment period has ended, with no comments or campaign details. Set the campaign to Archived to make the link stop answering.",
      isPubliclyReachable: false,
      isAcceptingSubmissions: false,
    };
  }

  if (campaign.status !== "active") {
    return {
      shareToken,
      portalPath,
      visibility: "staged",
      label: "Staged link",
      shortLabel: "Staged",
      detail: "A share link is saved, but the public page only resolves when the campaign status is Active.",
      isPubliclyReachable: false,
      isAcceptingSubmissions: false,
    };
  }

  // The dates outrank a staff close, because they are what still keeps the
  // page closed after comments are reopened. A page that never took comments
  // stays "view only" below: the dates change nothing about it.
  const dateClosure =
    campaign.submissions_closed_at || campaign.allow_public_submissions
      ? participationDateClosure(campaign, options)
      : null;
  if (dateClosure) {
    return {
      shareToken,
      portalPath,
      visibility: "live_closed",
      label: dateClosure.reason === "ended" ? "Live · submissions closed" : "Live · comments not open yet",
      shortLabel: "Live",
      detail: dateClosure.sentence,
      isPubliclyReachable: true,
      isAcceptingSubmissions: false,
    };
  }

  if (campaign.submissions_closed_at) {
    return {
      shareToken,
      portalPath,
      visibility: "live_closed",
      label: "Live · submissions closed",
      shortLabel: "Live",
      detail: "The public page is reachable, but new submissions are closed for this campaign.",
      isPubliclyReachable: true,
      isAcceptingSubmissions: false,
    };
  }

  if (campaign.allow_public_submissions) {
    return {
      shareToken,
      portalPath,
      visibility: "live_open",
      label: "Live · accepting submissions",
      shortLabel: "Live",
      detail: "The public page is reachable and can receive moderated public input.",
      isPubliclyReachable: true,
      isAcceptingSubmissions: true,
    };
  }

  return {
    shareToken,
    portalPath,
    visibility: "live_closed",
    label: "Live · view only",
    shortLabel: "Live",
    detail: "The public page is reachable, but public submission intake is turned off.",
    isPubliclyReachable: true,
    isAcceptingSubmissions: false,
  };
}

/**
 * The campaign's area of record, in the three states the console already
 * distinguishes. `unreadable` is a FAILED READ and must never be collapsed into
 * "unset" — that would send a planner to set an area that may already be on
 * record.
 */
export type PublicPortalAreaState = "set" | "unset" | "unreadable";

export function getPublicPortalReadiness(
  campaign: PublicPortalCampaignLike,
  areaState: PublicPortalAreaState = "unreadable",
  options: PortalClockOptions = {}
): PublicPortalReadiness {
  const shareToken = normalizeShareToken(campaign.share_token);
  const publicDescription = campaign.public_description?.trim() ?? "";
  const submissionsClosed = Boolean(campaign.submissions_closed_at);
  const allowsSubmissions = Boolean(campaign.allow_public_submissions);
  // Same rule as `getPublicPortalState`: once comments are on or closed by
  // staff, a past end date is what decides, and the step says so.
  const dateClosure =
    allowsSubmissions || submissionsClosed ? participationDateClosure(campaign, options) : null;

  // Planner words, one short sentence each. The publish checklist shows a
  // step's detail only while the step is open, so the open wording carries the
  // instruction and the done wording only has to confirm.
  const checks: PublicPortalReadinessCheck[] = [
    {
      id: "share_token",
      label: "Make the public link",
      passed: Boolean(shareToken),
      detail: shareToken
        ? "The public link is saved."
        : "The link stays closed to residents until the last step is done.",
    },
    {
      id: "active_status",
      label: "Go live",
      passed: campaign.status === "active",
      detail:
        campaign.status === "active"
          ? "The status is Active, so the link opens for residents."
          : "Set the status to Active when residents should be able to open the link.",
    },
    {
      id: "public_description",
      label: "Describe the project for residents",
      passed: publicDescription.length >= 24,
      detail:
        publicDescription.length >= 24
          ? "Residents read this before they comment."
          : "A few sentences on the project and what you want to hear about.",
    },
    {
      id: "submission_mode",
      label: "Let residents comment",
      passed: allowsSubmissions || submissionsClosed,
      // "Waits for review" is the moderation rule a planner has to know before
      // turning comments on; it stays in the done wording too.
      detail: dateClosure?.reason === "ended"
        ? dateClosure.sentence
        : allowsSubmissions
        ? "Residents can comment. Each comment waits for staff review before residents see it."
        : submissionsClosed
          ? "Comments are closed, so the page is view only."
          : "Each comment waits for staff review before residents see it.",
    },
  ];

  /*
    WHERE THE MAP OPENS, and why this does not block publishing.

    A tester published a corridor campaign with no area set, opened the resident
    link, and dropped a pin without panning — it landed at the geographic centre
    of the United States, because that is where a map with nothing to frame it
    opens. The publish checklist had said nothing, while the same page warned
    elsewhere that an area was needed for the map to open in the right place.

    It is a CHECK and not a BLOCK because absent is legitimate: a county-wide
    comment collection, or a question that is not about one place, genuinely has
    no area to set. Refusing to publish those would be the tidier rule and the
    wrong one. So this states the consequence and lets a planner decide — which
    is the same posture the resident map itself now takes, telling a visitor the
    map is not set to one place rather than pretending the wide view is a choice.
  */
  checks.push({
    id: "map_opens_somewhere",
    label: "Choose where the map opens",
    // An unreadable area is NOT a missing one. It passes rather than sending a
    // planner to set something that may already be there; the console's own
    // area panel is where a failed read is reported.
    passed: areaState !== "unset",
    detail:
      areaState === "set"
        ? "The map opens on this area."
        : areaState === "unreadable"
          ? "The area could not be read just now, so this step cannot be checked. That is a failed read, not a missing area."
          : "No area is set. A pin dropped without moving the map lands in the middle of the country. Skip this step if the project is not about one place.",
  });

  const completeCount = checks.filter((check) => check.passed).length;
  const totalChecks = checks.length;
  const firstFailedCheck = checks.find((check) => !check.passed);

  return {
    label: completeCount === totalChecks ? "Ready to share" : "Needs setup",
    completeCount,
    totalChecks,
    checks,
    nextAction: firstFailedCheck?.detail ?? "Portal is ready for public outreach and copy/share handoff.",
  };
}
