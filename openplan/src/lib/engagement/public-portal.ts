export type PublicPortalCampaignLike = {
  status?: string | null;
  share_token?: string | null;
  public_description?: string | null;
  allow_public_submissions?: boolean | null;
  submissions_closed_at?: string | null;
};

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

export function getPublicPortalState(campaign: PublicPortalCampaignLike): PublicPortalState {
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
  areaState: PublicPortalAreaState = "unreadable"
): PublicPortalReadiness {
  const shareToken = normalizeShareToken(campaign.share_token);
  const publicDescription = campaign.public_description?.trim() ?? "";
  const submissionsClosed = Boolean(campaign.submissions_closed_at);
  const allowsSubmissions = Boolean(campaign.allow_public_submissions);

  const checks: PublicPortalReadinessCheck[] = [
    {
      id: "share_token",
      label: "Share token saved",
      passed: Boolean(shareToken),
      detail: shareToken
        ? "The campaign has a stable public URL for outreach materials."
        : "Generate and save a share token before sending public outreach.",
    },
    {
      id: "active_status",
      label: "Campaign active",
      passed: campaign.status === "active",
      detail:
        campaign.status === "active"
          ? "The portal route can resolve for public visitors."
          : "Move the campaign to Active when the portal should be reachable.",
    },
    {
      id: "public_description",
      label: "Public description present",
      passed: publicDescription.length >= 24,
      detail:
        publicDescription.length >= 24
          ? "Visitors get enough context before submitting feedback."
          : "Add a short public description explaining the project and requested feedback.",
    },
    {
      id: "submission_mode",
      label: "Submission mode intentional",
      passed: allowsSubmissions || submissionsClosed,
      detail: allowsSubmissions
        ? "The portal is configured to accept moderated public submissions."
        : submissionsClosed
          ? "Submissions are explicitly closed, so the portal is view-only by design."
          : "Enable public submissions or close submissions to make the portal's intake posture explicit.",
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
    label: "Resident map opens on the right place",
    // An unreadable area is NOT a missing one. It passes rather than sending a
    // planner to set something that may already be there; the console's own
    // area panel is where a failed read is reported.
    passed: areaState !== "unset",
    detail:
      areaState === "set"
        ? "The resident map opens on this campaign's area."
        : areaState === "unreadable"
          ? "This campaign's area could not be read just now, so this step cannot be checked. That is a failed read, not a missing area."
          : "No area is set, so the resident map opens wide — a visitor who drops a pin without moving the map first will place it in the middle of the country. Set an area, or leave it if this campaign is not about one place.",
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
