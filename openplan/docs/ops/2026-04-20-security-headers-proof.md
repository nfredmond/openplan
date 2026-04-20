# Baseline security headers (2026-04-20)

## What shipped

Added five baseline HTTP security response headers to every route via `NextConfig.headers()` in `openplan/next.config.ts`. Next layer of defense after markdown renderer hardening — browser-enforced posture alongside server-side sanitization.

```ts
async headers() {
  return [{
    source: "/:path*",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ],
  }];
}
```

## What each header defends against

| Header | Defends against | Why this value |
|---|---|---|
| `X-Content-Type-Options: nosniff` | MIME-type confusion attacks (browser auto-detecting a text file as HTML/JS) | Universal baseline — no downside |
| `X-Frame-Options: DENY` | Clickjacking (attacker embedding OpenPlan in an `<iframe>` to steal clicks) | OpenPlan has no legitimate embed case; `DENY` is stricter than `SAMEORIGIN` |
| `Referrer-Policy: strict-origin-when-cross-origin` | Leaking full URL (path + query) to third-party services via `Referer` header | Next.js default is the same — documented here explicitly in case defaults change |
| `Permissions-Policy: camera=(), microphone=(), geolocation=(self), interest-cohort=()` | Third-party iframes silently using sensitive browser APIs; FLoC ad-tracking | `geolocation=(self)` allows first-party use (future Aerial features); everything else locked down |
| `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` | Protocol-downgrade attacks (attacker intercepts HTTP → HTTPS redirect) | 2-year `max-age` + `preload` is the hsts-preload list's minimum |

## What's *not* in this slice

**Content-Security-Policy.** CSP would be the strongest browser-layer defense (blocks inline scripts + restricts connect/script/img origins), but a correctly-scoped CSP for OpenPlan needs:

- `script-src` with a nonce for Next.js RSC bootstrap inline scripts
- `connect-src` allowing Supabase (`*.supabase.co` + local dev), Mapbox (`api.mapbox.com`, `events.mapbox.com`, `*.tiles.mapbox.com`), Anthropic API (streaming chat)
- `img-src` allowing Mapbox tiles + Supabase storage + `data:` + `blob:`
- `worker-src blob:` for MapLibre/Mapbox GL workers
- `font-src` for any CDN fonts
- A `report-uri` or `report-to` endpoint so we see violations before they break prod

Shipping CSP without all of that risks breaking the map, the AI chat, image uploads, or the Supabase realtime connection. Right next slice: run CSP in **report-only** mode for 1-2 days, collect violations, then flip to enforcing.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit     # exit 0
pnpm lint                  # 0 warnings
pnpm test -- --run         # 172 files · 809 tests · 11.59s (unchanged)
```

Test count unchanged — `next.config.ts` headers don't show up in unit tests (they're verified at HTTP-response time). Manual verification:

```bash
pnpm dev &
curl -sI http://localhost:3000/ | grep -iE "x-content-type|x-frame|referrer-policy|permissions-policy|strict-transport"
```

All five should appear. (HSTS is respected by browsers only over HTTPS — localhost Dev has the header but browsers ignore it.)

## Why these headers and not more

There is a longer list (X-XSS-Protection, X-DNS-Prefetch-Control, Expect-CT, etc.). The five shipped are either:

- **Enforced by all modern browsers** and have no downside at this config (`X-Content-Type-Options`, `Referrer-Policy`).
- **Close off a clear attack class with no legitimate counter-use** in OpenPlan (`X-Frame-Options: DENY`, `Permissions-Policy`).
- **Required for production HTTPS posture** (`Strict-Transport-Security`).

Omitted:
- `X-XSS-Protection` — deprecated; modern browsers ignore it and CSP supersedes it.
- `Expect-CT` — deprecated; CT is automatic in modern browsers.
- `X-DNS-Prefetch-Control` — performance, not security; defaults are fine.

## Files

- `openplan/next.config.ts` — `headers()` block added.

## Pointers

- Markdown renderer hardening (previous slice): `docs/ops/2026-04-20-markdown-dompurify-hardening-proof.md`
- Security-advisor Wave-1 proof: `docs/ops/2026-04-20-security-advisor-wave1-proof.md`
- Security-advisor backlog: `docs/ops/2026-04-20-security-advisor-backlog.md`
