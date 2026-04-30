export function resolvePublicMapboxToken(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const token = normalizeToken(candidate);
    if (token.startsWith("pk.")) return token;
  }

  return "";
}

export function hasInvalidPublicMapboxToken(...candidates: Array<string | null | undefined>): boolean {
  return candidates.some((candidate) => {
    const token = normalizeToken(candidate);
    return Boolean(token && !token.startsWith("pk."));
  });
}

function normalizeToken(candidate: string | null | undefined): string {
  return (candidate ?? "").trim().replace(/^['\"]|['\"]$/g, "");
}
