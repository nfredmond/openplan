export type PublicPortalCampaignLike = {
  status?: string | null;
  share_token?: string | null;
  allow_public_submissions?: boolean | null;
  submissions_closed_at?: string | null;
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
