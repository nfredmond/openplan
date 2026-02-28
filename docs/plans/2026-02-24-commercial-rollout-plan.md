# OpenPlan Commercial Rollout Plan (v2 — Post Deep Dive)
_Date: 2026-02-24 | Revised after full audit of 12+ prior repos, 4 Google Docs, and promt1.md research_

## 1) Executive Summary
Ship a sellable OpenPlan SaaS product for small/rural agencies, tribal programs, and consultancies. Subscription model. 90-day timeline to first pilot.

**Critical lesson from 12+ prior attempts:** Every version failed because it tried to build everything at once. This plan is intentionally narrow. We ship ONE workflow perfectly, validate with paying customers, then expand.

## 2) What We Learned From Prior Attempts

### Assets We're Keeping
| Source | What We're Using |
|--------|-----------------|
| `Saas.Claude/openplan` | Canonical codebase, Supabase/PostGIS migrations, auth, workspace architecture |
| `promt1.md` | Market research, competitive positioning, tech stack recommendations |
| CAMP Integration Guide | Multi-tenant SQL schema patterns, API route patterns |
| `python-demand-model` | Core trip generation + gravity model algorithms (for Phase 2) |
| FreeChAMP | Model run wizard UX patterns (for Phase 2) |
| `SaaS` repo | Report generation templates, UX patterns |
| transitscore-3d | Monetization model, accessibility analysis patterns |

### What We're NOT Doing (Lessons from Failures)
1. No ActivitySim integration in MVP — too complex, not needed for first sale
2. No framework switching — we're on Next.js 16 + MapLibre + Supabase, period
3. No `ignoreBuildErrors: true` — the build must always pass clean
4. No feature without a backlog item + acceptance criteria
5. No new module until the previous one works reliably end-to-end

## 3) Target Customer + Use Case

### Primary Buyer
Small/rural transportation agencies, tribal transportation programs, counties/county-equivalents, RTPAs/transportation commissions, and small consultancies across the United States.

### Killer Use Case
**Grant application support.** These agencies spend $15K-$50K per ATP/SS4A/RAISE application hiring consultants to do accessibility analysis, equity assessment, and write the technical sections. If OpenPlan can generate a defensible analysis + report in 15 minutes, a $599/mo subscription pays for itself on the first grant cycle.

### Why They'll Buy
- Current tools (Replica, StreetLight) start at $50K+/year
- They don't have in-house GIS/modeling staff
- Grant deadlines are real and frequent (ATP cycles, SS4A, RAISE)
- AI-assisted report generation saves weeks of consultant time

## 4) MVP Scope (Deliberately Minimal)

### What the MVP Does
1. **Corridor Definition** — Upload GeoJSON or draw on map
2. **Automated Analysis** — Pull Census/ACS demographics, LEHD/LODES employment, GTFS transit access, crash data (FARS/SWITRS) for the corridor
3. **Accessibility Score** — Walk/bike/transit accessibility using network analysis
4. **Equity Assessment** — EJ screening (Census tract demographics + CEJST/ETC overlay)
5. **Safety Analysis** — Crash density + HIN proximity
6. **AI Summary** — Natural language interpretation of results
7. **Report Generation** — Professional PDF suitable for grant applications
8. **Run History** — Save, revisit, compare past analyses

### What the MVP Does NOT Do
- Full demand modeling (Phase 2)
- Public engagement (Phase 3)
- Construction tracking (Phase 4+)
- Scenario comparison engine (Phase 2)
- Custom data upload beyond corridor geometry (Phase 2)

## 5) Technical Architecture (Locked)

| Layer | Technology | Status |
|-------|-----------|--------|
| Framework | Next.js 16 (App Router) | ✅ In place |
| Database | Supabase (PostgreSQL + PostGIS) | ✅ Migrations exist |
| Auth | Supabase Auth | ✅ Wired |
| Map | MapLibre GL JS | ✅ In place |
| Data Viz | deck.gl | ✅ Dependency exists |
| AI | Vercel AI SDK | ✅ Dependency exists |
| Hosting | Vercel (app) + Supabase (DB) | ✅ Accounts exist |
| Styling | Tailwind + shadcn/ui | ✅ In place |

### Data Sources for MVP Analysis
| Source | Data | Access |
|--------|------|--------|
| Census/ACS API | Demographics, income, vehicle ownership, commute mode | Free API |
| LEHD/LODES | Block-level employment OD data | Free download |
| GTFS | Transit routes, stops, schedules | Free feeds |
| FARS | Fatal crash data | Free API |
| SWITRS | CA crash data | Free download |
| CEJST | Disadvantaged community screening | Free API |
| OpenStreetMap | Road/bike/pedestrian network | Free |
| NPMRDS | Travel time/speed on NHS roads | Free for public agencies |

## 6) 90-Day Rollout

### Phase A — Foundation (Weeks 1-2) ← CURRENT
- [x] Auth forms wired to Supabase
- [x] Workspace route protection
- [x] Analysis API endpoint (demo metrics)
- [x] Run persistence (workspace-scoped)
- [x] Corridor upload component
- [x] Run history component
- [x] Report generation endpoint
- [x] Explore workspace with map + controls
- [x] Build passes clean
- [ ] Sign-out + session management
- [ ] Wire real Census/ACS API calls into analysis endpoint
- [ ] Wire LEHD/LODES data lookup
- [x] Basic smoke tests

### Phase B — Real Analysis Engine (Weeks 3-5)
- [ ] GTFS feed ingestion for transit accessibility
- [ ] OSM network for walk/bike accessibility (isochrone-based)
- [ ] FARS/SWITRS crash data integration
- [ ] CEJST equity screening overlay
- [ ] AI-powered result interpretation (Vercel AI SDK)
- [ ] Professional PDF report template (grant-application quality)
- [ ] Demo script: 10-15 minute walkthrough without intervention
- [ ] Nathaniel approval of report output quality

### Phase C — Commercial Readiness (Weeks 6-8)
- [ ] Stripe subscription integration (Starter / Professional tiers)
- [ ] Onboarding flow for new agencies
- [ ] Landing page + marketing site
- [ ] Terms of Service + Privacy Policy
- [ ] Security audit (RLS policies, input validation, rate limiting)
- [ ] Pilot data packs for 3 target agencies

### Phase D — Pilot & Convert (Weeks 9-12)
- [ ] Run 2-3 pilots with real agencies
- [ ] Collect outcomes and testimonials
- [ ] Iterate based on feedback
- [ ] Convert at least 1 pilot to paid subscription
- [ ] Plan Phase 2 backlog based on pilot learnings

## 7) Packaging & Pricing

| Tier | Price | Includes |
|------|-------|---------|
| **Starter** | $599/mo | 1 workspace, 10 analyses/mo, PDF reports, email support |
| **Professional** | $1,499/mo | 3 workspaces, unlimited analyses, priority support, custom branding on reports |
| **Enterprise** | Custom annual | Unlimited workspaces, SSO, dedicated onboarding, custom data integration |

### Services Add-ons
- Onboarding workshop: $2,500 one-time
- Custom grant support package: $5,000-$15,000
- Custom modeling engagement: hourly at Nat Ford consulting rates

## 8) Delivery Operating Rules
1. **One canonical repo only** (`Saas.Claude/openplan`)
2. **Build must always pass clean** — no `ignoreBuildErrors`
3. **Every feature maps to a backlog item** with acceptance criteria
4. **No net-new modules until MVP is reliable**
5. **Demo-first development** — every sprint improves the live demo
6. **Salvage, don't rebuild** — reuse patterns from prior attempts, don't start fresh

## 9) Success Metrics
- Internal demo success rate >90%
- Time-to-first-insight <15 minutes (corridor upload → report)
- Report quality: suitable for ATP/SS4A application attachment
- Pilot conversion: ≥1 paid subscription from first 3 pilots
- Support burden: manageable by Nathaniel + Bartholomew

## 10) Phase 2 Preview (Post-MVP, ~Q3 2026)
Based on prior work inventory, Phase 2 candidates (prioritized by customer demand):
1. Scenario comparison (before/after analysis)
2. Trip generation + gravity model (from python-demand-model)
3. VMT per capita estimation
4. Dashboard with multiple metric views
5. Public engagement module (from DOT-Dashboard patterns)

Phase 2 scope will be determined by pilot customer feedback, not by our assumptions.
