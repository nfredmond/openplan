export type PublicPortalCampaignLike = {
  status?: string | null;
  share_token?: string | null;
  public_description?: string | null;
  allow_public_submissions?: boolean | null;
  submissions_closed_at?: string | null;
};

export type PublicPortalReadinessCheck = {
  id: "share_token" | "active_status" | "public_description" | "submission_mode";
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
  detail: string;
  isPubliclyReachable: boolean;
  isAcceptingSubmissions: boolean;
};

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
    detail: "The public page is reachable, but public submission intake is turned off.",
    isPubliclyReachable: true,
    isAcceptingSubmissions: false,
  };
}

export function getPublicPortalReadiness(campaign: PublicPortalCampaignLike): PublicPortalReadiness {
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
