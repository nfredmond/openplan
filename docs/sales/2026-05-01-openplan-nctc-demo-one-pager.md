# OpenPlan NCTC Demo One-Pager

_Date: 2026-05-01_
_Status: Buyer-safe review copy; use with the caveat sheet and guided-demo script._

## What This Is

OpenPlan includes a private proof-of-capability workspace using Nevada County / Nevada County Transportation Commission geography to show how a rural RTPA-style workflow can keep plan chapters, project records, model evidence, caveats, reports, maps, and review artifacts connected.

This is not an endorsement by NCTC, not an active partnership, not a procurement signal, and not a claim that NCTC reviewed, approved, or supplied non-public data. The demo uses Nevada County / NCTC geography because it is a realistic rural planning scale.

## What The Demo Shows

The strongest first walkthrough is an RTP/report packet workflow:

- a Nevada County / NCTC demo workspace labeled as a demo workspace;
- an NCTC 2045 RTP proof-of-capability project and draft RTP cycle;
- an existing-conditions and travel-patterns chapter with source-linked model evidence;
- a county-run evidence record with frozen manifest and validation summary;
- generated report/document posture with visible caveats; and
- the same project spine reused across adjacent OpenPlan workflows, including RTP, grants, engagement, analysis, reports, map/Data Hub, and aerial evidence in local smoke proof.

## Screening Evidence In The Demo

The frozen county-run artifact `nevada-county-runtime-norenumber-freeze-20260324` produced screening-grade outputs including:

- 973.8 square miles of study area;
- 26 census-tract-fragment traffic analysis zones;
- 102,322 residents and 48,252 estimated jobs;
- 628,262 total daily person-trips;
- a 54,944-link road network with 95.97% largest-component coverage;
- assignment convergence at 0.00955 relative gap after 50 iterations; and
- 5 of 5 matched Caltrans 2023 priority count stations.

Validation is deliberately caveated: median absolute percent error was 27.4%, while the highest observed station error was 237.62% at SR-174 at Brunswick Rd. That high-error facility keeps the model in screening-grade proof posture, not planning-grade forecasting posture.

## What This Is Not

OpenPlan should not be presented from this demo as:

- validated behavioral forecasting;
- a calibrated production travel-demand model;
- legal, engineering, or compliance sign-off;
- certified grant scoring;
- autonomous AI planning; or
- broad self-serve municipal SaaS.

The demo is useful for deciding whether a supervised pilot is worth scoping. A production engagement would replace demo assumptions with buyer-reviewed inputs, local validation, agreed caveats, and a scoped deliverable.

## What A Production Pilot Would Replace

| Demo proof | Production pilot input |
|---|---|
| OSM default speeds and capacities | Locally reviewed or calibrated network |
| Tract-fragment TAZs | Buyer-reviewed zone system |
| Jobs estimated from public demographic proxies | Buyer-approved employment data and local context |
| Five-station screening validation | Agreed validation set and acceptance posture |
| Internal prototype caveat | Scoped deliverable caveat approved before reliance |

## 30-Minute Walkthrough

Use the guided demo to answer one concrete question: can OpenPlan help a rural RTPA or county keep RTP evidence, caveats, reports, and project records connected enough to justify a 30-90 day supervised pilot?

Recommended flow:

1. Confirm the no-endorsement and screening-grade boundary.
2. Show the demo workspace and project spine.
3. Show the RTP/report packet evidence.
4. Show the county-run manifest and validation summary.
5. Show generated document/report posture.
6. Ask whether a narrow supervised pilot around one plan chapter, corridor, or board-packet deliverable is worth scoping.

## Proof Links

- Phase 1 spine proof: [2026-05-01 OpenPlan local spine smoke](../ops/2026-05-01-openplan-local-spine-smoke.md)
- Admin pilot readiness packet: [2026-05-01 OpenPlan admin pilot readiness proof packet](2026-05-01-openplan-admin-pilot-readiness-proof-packet.md)
- Buyer-safe caveat sheet: [2026-05-01 OpenPlan buyer-safe caveat sheet](2026-05-01-openplan-buyer-safe-caveat-sheet.md)
- Guided demo script: [2026-05-01 OpenPlan demo workspace script](2026-05-01-openplan-demo-workspace-script.md)

## Contact

Nat Ford Planning & Analysis can host, configure, support, and scope OpenPlan pilots around the Apache-2.0 open-source core. Reply through the current outreach thread to request a guided walkthrough or a scoped pilot conversation.
