# OpenPlan — Demo one-pager (NCTC proof-of-capability) — **Draft**

_Date: 2026-04-19_
_Status: **Draft copy for Nathaniel / Claire review.** Pricing, tone, and any named-partner language below are placeholders. Do not send without review._

---

## What this is

**A rural RTPA's regional transportation plan — built with OpenPlan, anchored to real Nevada County geography, grounded in a real screening-grade travel demand model.**

This is not a sales deck. It is a browsable demo workspace you can open in under a minute and audit end-to-end.

## What OpenPlan produced for Nevada County

Starting from a county-FIPS boundary and publicly-available OSM + ACS + LODES data, one screening-grade AequilibraE run produced:

- A **973.8 sq mi** study area with 26 census-tract-fragment TAZs
- **102,322** residents · **48,252** estimated jobs · **628,262** total daily person-trips
- A **54,944-link** road network with 95.97% largest-component coverage, converged at a **0.00955** relative gap after 50 iterations
- Validation against 5 Caltrans 2023 priority count stations: **5/5 matched**, median absolute percent error **27.4%**, max **237.6%** (SR-174 at Brunswick Rd)
- A populated "Existing conditions and travel patterns" RTP chapter composed from those numbers — not hand-typed

Every figure in the demo chapter traces back to the frozen run artifact `nevada-county-runtime-norenumber-freeze-20260324`. Auditors can verify every cell against a specific source file.

## What this demo is NOT

We are deliberately honest about the prototype's limits:

- **Screening-grade, not planning-grade.** OSM default speeds/capacities, tract-fragment TAZs, jobs estimated from demographic proxies, external gateways inferred from motorway boundary crossings.
- **Not a calibrated travel demand model.** A production Nevada County RTP would require local survey data (NHTS expansion, household travel diary), calibrated TAZs, capacity calibration against observed LOS.
- **Not an equity impact analysis.** The platform's equity lens (pct minority, pct zero-vehicle, pct poverty) exists but has not been scored against a project portfolio in this demo.
- **Not a transit or active-transportation accessibility analysis.** Phase 1 scope is auto-mode screening.
- **Internal prototype only** per the screening gate — one core facility has 237.62% APE, above the 50% critical-facility threshold for planning-grade use.

Those caveats appear verbatim in the demo chapter, on every load-bearing claim. OpenPlan does not hide them behind polished UI.

## What a production engagement would replace

The platform's chapter structure, evidence linkage, freeze/drift discipline, and adoption-packet flow **do not change** when you move from screening to planning-grade inputs. What changes:

| Screening-grade (demo) | Planning-grade (production) |
|---|---|
| OSM default speeds + capacities | Calibrated network per local observations |
| Tract-fragment TAZs (26 zones) | Locally-calibrated TAZ system |
| Jobs via ACS/LODES proxy | Licensed employment data + local QCEW joins |
| 5-station screening validation | Full count program + NHTS-style behavior calibration |
| "Internal prototype only" gate | Ready-for-adoption posture with equity + safety modules |

## Why this matters for a small RTPA

Most small agencies and RTPAs cannot afford the commercial travel-demand-platform fees the big MPO toolchains require. The OpenPlan thesis is that a defensible, auditable, screening-first workflow — augmented with calibration and local data when stakes rise — covers 80% of what a rural RTPA actually needs for an RTP cycle, at a fraction of the cost and without surrendering the reasoning chain to a vendor black box.

## The demo workspace

- **Workspace name:** Nevada County Transportation Commission (demo)
- **Marker:** `is_demo = true` (filtered out of production billing and analytics)
- **Project:** NCTC 2045 RTP (proof-of-capability)
- **RTP cycle:** 2026–2045 horizon, status = draft
- **Chapter on display:** Existing conditions and travel patterns (ready for review)
- **County-run:** nevada-county-runtime-norenumber-freeze-20260324 (stage: validated-screening)

_The demo is signed-in only — we can share a login on request rather than exposing it at a public URL._

## What you get from a conversation

A 30-minute walkthrough covers:

1. The demo chapter on the cycle detail page, caveats inline.
2. The compiled document view (`/rtp/{cycle}/document`).
3. The county-run detail surface with the verbatim manifest + validation summary.
4. Exports (PDF/HTML) that preserve every screening-grade disclosure.
5. Discussion of what a real Nevada County (or your agency) engagement would cost and deliver.

## Next steps

- Ask for a 30-minute walkthrough with a login to the demo workspace.
- Or send us your corridor / agency / planning question and we will annotate it against what the demo currently supports and what a production engagement would require.

**Contact:** _[contact line — Nathaniel to fill in preferred channel]_

---

### Draft review checklist (internal)

Before this one-pager goes out:

- [ ] Confirm pricing language (or intentional absence of pricing).
- [ ] Confirm "signed-in only" posture for the demo or switch to a read-only share.
- [ ] Confirm the contact line + channel (email vs. calendar link).
- [ ] Confirm Claire / Nathaniel voice pass on tone — this draft leans technical.
- [ ] Confirm no named-partner language (NCTC hasn't endorsed this; the demo uses their geography, not their sign-off).
- [ ] Confirm disclosure language aligns with the Nat Ford covenant on AI disclosure, fairness, and vulnerable-community protection.
- [ ] If converting to PDF: layout pass, typography, and print-to-PDF verification.

### Data provenance

Every number in the "What OpenPlan produced" section comes from one of:
- `data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/bundle_manifest.json`
- `data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/validation/validation_summary.json`

Both files are loaded verbatim into the demo workspace's `county_runs` row (`manifest_json` + `validation_summary_json` columns) so auditors can re-derive any figure.

### Related internal docs

- Phase P decision #5 (agency pick): `openplan/docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Phase Q scope + session sequence: `openplan/docs/ops/2026-04-19-phase-q-scope.md`
- Q.1 seed proof: `openplan/docs/ops/2026-04-19-phase-q1-nctc-demo-seed-proof.md`
- Q.2 chapter proof: `openplan/docs/ops/2026-04-19-phase-q2-existing-conditions-chapter-proof.md`
