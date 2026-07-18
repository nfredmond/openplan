# Grants lane: grants.gov live sync (shipped 2026-07-18)

## What shipped

Live federal opportunity discovery on `/grants`, deferred from v1 ("live grants.gov sync").
Zero schema changes and zero new secrets — the public grants.gov Search2 API needs no key.

- `src/lib/grants/grants-gov.ts` — pure helpers: search-body builder (defaults: transportation
  funding category `T`, `forecasted|posted`, 25 rows), defensive response parser (returns null
  on anything that is not a successful Search2 payload — callers show an honest offline state),
  MM/DD/YYYY→ISO date conversion that rejects impossible dates, a deadline-window describer
  with escalating tones (≤14 days danger, ≤30 warning), and `toFundingOpportunityDraft` which
  maps a synopsis to the existing `POST /api/funding-opportunities` create schema — including
  real `opensAt`/`closesAt` datetimes, something the static catalog's Track button cannot do.
- `src/app/api/grants-gov/opportunities/route.ts` — auth-gated proxy (member read): 10s upstream
  timeout, per-process 30-minute TTL memo (`src/lib/grants/grants-gov-cache.ts`; POST fetches
  are never stored in Next's data cache), 502 `grants_gov_unreachable` on any upstream problem,
  failures never cached.
- `src/components/grants/grants-gov-live-section.tsx` — lazy-fetch section mounted after the
  curated program catalog: nothing loads until the operator asks, keyword filter, per-row
  deadline-window badge, "Track as opportunity" reusing the same route as the catalog section,
  honest offline/zero-hit states, `GRANTS_GOV_SYNC_CAVEAT` always visible.

## Design decisions

- **Proxy, don't fetch from the browser**: avoids CORS, keeps the upstream endpoint in one
  place, and lets the server memoize so a refresh-happy operator can't hammer grants.gov.
- **Lazy load**: `/grants` must never block on, or break with, an external API.
- **Synopsis-level honesty**: every surface (caveat, tracked-record summary, cadence label)
  says to verify eligibility/match/deadlines in the NOFO; close dates map to end-of-day so a
  tracked opportunity is not shown as closed on its deadline day.
- **Cache is per server process** — fine for local/self-hosted single-instance deploys; a
  multi-instance deploy would just fetch once per instance per 30 minutes, which is still polite.

## Tests

32 new tests: `grants-gov.test.ts` (15, incl. a fixture trimmed from a real captured Search2
response), `grants-gov-route.test.ts` (10: auth, validation, proxy, cache hit/miss/per-key,
502 paths, no-cache-on-failure), `grants-gov-live-section.test.tsx` (7: lazy load, offline,
zero-hit, track body with real dates, already-tracked, track-failure surface).

## Not done yet (deliberate)

- No background refresh/cron and no persistence of search results — discovery stays pull-based
  until there's a real need; tracked opportunities are the durable record.
- No agency/eligibility facets in the UI — keyword + transportation category covers the demo;
  the lib's body builder already accepts more fields when wanted.
