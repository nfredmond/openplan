# CSP in `Report-Only` mode + violation sink (2026-04-20)

## What shipped

1. **`Content-Security-Policy-Report-Only` header** — now emitted on every route via `NextConfig.headers()` in `openplan/next.config.ts`. Nothing gets blocked; browsers parse the policy and POST violation reports to the sink.
2. **`POST /api/csp-report`** — new route at `openplan/src/app/api/csp-report/route.ts` that accepts CSP1 legacy and Reporting API modern payloads, normalizes each violation, and writes a `csp_violation` warn-level audit line through the existing `createApiAuditLogger`. Always returns 204 — a broken sink must not become a bigger outage than the missing reports.

## The policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com https://*.supabase.co;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com;
worker-src 'self' blob:;
font-src 'self' data:;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
report-uri /api/csp-report
```

### Why each directive is shaped this way

| Directive | Value | Reason |
|---|---|---|
| `default-src 'self'` | same-origin baseline | Fallback for anything we forget to list explicitly. |
| `script-src 'self' 'unsafe-inline' 'unsafe-eval'` | loose | Next.js 15 App Router injects inline RSC-bootstrap scripts without nonces today. Tightening requires a nonce middleware — deferred to a follow-up. Report-only means this looseness is cosmetic; nothing would block anyway. |
| `style-src 'self' 'unsafe-inline'` | loose | Next.js streams inline style tags for RSC. Same reasoning. |
| `img-src 'self' data: blob: https://*.mapbox.com https://*.tiles.mapbox.com https://*.supabase.co` | precise | Map tiles come from `*.tiles.mapbox.com`, `api.mapbox.com` occasionally serves style/sprite images, Supabase Storage is `*.supabase.co`, MapLibre/Mapbox GL generates `blob:` and `data:` image URIs for icon sprites. |
| `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com` | precise | Supabase REST + WebSocket realtime, Mapbox tile + events telemetry + API. Anthropic API is **not** listed — AI streaming runs on the server inside `api/chat` and `api/assistant` routes, so the browser only connects to `'self'` for those. |
| `worker-src 'self' blob:` | required | MapLibre/Mapbox GL creates Web Workers from blob URIs for offscreen tile decoding. |
| `font-src 'self' data:` | permissive-data | No CDN fonts; some tooling (icon libs, Tailwind) emits small `data:` fonts. |
| `frame-ancestors 'none'` | strict | Paired with already-shipped `X-Frame-Options: DENY`. CSP's directive supersedes the header in modern browsers. |
| `form-action 'self'` | strict | Forms POST only to our own routes. |
| `base-uri 'self'` | strict | Prevents a `<base>` tag injection from re-targeting relative URLs. |
| `object-src 'none'` | strict | No `<object>`/`<embed>`/legacy plugins. |
| `report-uri /api/csp-report` | required | Where violations land. |

## The sink

```ts
// src/app/api/csp-report/route.ts
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("csp.report", request);
  let parsed: unknown = null;
  try {
    const text = await request.text();
    if (text.trim().length > 0) parsed = JSON.parse(text);
  } catch { /* malformed report must not fail the sink */ }

  for (const report of extractReports(parsed)) {
    audit.warn("csp_violation", report);
  }
  return new NextResponse(null, { status: 204 });
}
```

- **Dual-shape extractor.** `report-uri` browsers (most of the install base) POST `{ "csp-report": { ... } }`. `report-to` browsers POST an array of `{ type: "csp-violation", body: { ... } }`. The extractor handles both, and also falls back to treating the top-level object as the report itself if neither shape matches.
- **No auth.** CSP reports fire before the page hydrates and from origins that the browser may consider opaque. Requiring `createClient()` auth would drop most reports.
- **No DB writes.** Violations flow through `createApiAuditLogger` → `console.warn(JSON.stringify(...))` → Vercel runtime logs, keyed on `subsystem: "openplan/api", route: "csp.report", event: "csp_violation"`. Grep `event="csp_violation"` to audit. Adding a DB table would be premature for a 1-2 day observation window.
- **Always 204.** Even on malformed JSON, empty body, or zero extracted reports. The sink is fire-and-forget from the browser's perspective — returning 4xx would generate noise in browser dev-tools and pollute the report of the original violation.

## Tests

`src/test/csp-report-route.test.ts` — 4 cases:

1. **Legacy CSP1 payload** → one `audit.warn("csp_violation", ...)` call with all normalized fields, returns 204.
2. **Modern Reporting API array payload** (2 entries) → two `audit.warn(...)` calls, returns 204.
3. **Malformed JSON body** → 204, `audit.warn` never called, no throw.
4. **Empty body** → 204, `audit.warn` never called.

All four pass.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit     # exit 0
pnpm lint                  # 0 warnings
pnpm test -- --run         # 173 files · 813 tests · 11.43s
```

Net +4 tests (809 → 813), +1 file (172 → 173).

## Manual verification recipe

```bash
pnpm dev &
curl -sI http://localhost:3000/ | grep -i content-security-policy
# content-security-policy-report-only: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...

curl -X POST http://localhost:3000/api/csp-report \
  -H 'content-type: application/csp-report' \
  -d '{"csp-report":{"violated-directive":"img-src","blocked-uri":"https://evil.example/x.png","document-uri":"http://localhost:3000/"}}'
# → 204 + JSON warn line on stderr with event="csp_violation"
```

Then open `http://localhost:3000/explore` in a browser, load the map, trigger a chat request. Any `csp_violation` lines that appear are exactly the information the enforcing-mode follow-up will use.

## Files

- `openplan/next.config.ts` — `SECURITY_HEADERS` extended with `Content-Security-Policy-Report-Only`; policy extracted to module-level `CSP_REPORT_ONLY_POLICY` const.
- `openplan/src/app/api/csp-report/route.ts` — new, 76 LOC.
- `openplan/src/test/csp-report-route.test.ts` — new, 110 LOC / 4 tests.

## Not this slice

- **Enforcing CSP.** Next slice, after 1-2 days of violation observation against dev + prod.
- **Nonce-based `script-src`.** Requires a request-scoped middleware that injects a per-request nonce into every inline `<script>`. Separate slice; Next.js has a documented pattern using middleware + `headers()`.
- **Persisting violations to Supabase.** Log-grep is adequate for the observation window. Revisit after enforcing cutover if violation-trend dashboards become useful.
- **Report-To / Reporting API endpoint group.** The modern alternative to `report-uri`. `report-uri` still works in every major browser; adding `report-to` requires a separate `Report-To` header + different payload shape that we already handle defensively in the sink. Can add later without breaking the deprecated `report-uri` path.

## Pointers

- Prior slice: `docs/ops/2026-04-20-security-headers-proof.md` (baseline headers)
- Audit logger: `src/lib/observability/audit.ts:117`
- Mock pattern used in tests: `src/test/county-run-enqueue-route.test.ts:24-26`
