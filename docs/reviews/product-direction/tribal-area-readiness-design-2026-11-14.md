# Readiness for a tribal area: design, November 14, 2026

Written by an agent (lane 50) for the first proven job's follow-up (PR 484,
review 43 finding 7). This page designs the change. It does not build it.

## What happens today

The readiness registry (`openplan/src/lib/jurisdiction-readiness/registry.v1.json`)
has one row per state, DC and inhabited territory for each of five jobs. The
resolver (`registry.ts`) finds a row by country and state code. A tribal area
(Census AIANNH place kind) never has a state code on record:
`subdivisionCodeFromTigerwebGeoid` returns none for an AIANNH id such as
`3010R`, even when the area lies in one state. The place resolver does read
each area's states (`aiannhStateFips`), and the first proven job record holds
`stateFips: ["32"]` for the Pyramid Lake Paiute Reservation, but that list
never reaches the readiness resolver.

So every job for a tribal area reads "Not assessed here". Until this change
the reason read "The selected place does not identify one subdivision, so
OpenPlan cannot apply a subdivision claim", which tells a tribal planner
nothing. That is what the Pyramid Lake safety action plan printed five times.

## What it says meanwhile (built in this PR)

The status stays "Not assessed here" for all five jobs. The reason now reads:

> This place has no single state, DC or territory on record. OpenPlan records
> none for a tribal area, even one inside one state, and assesses readiness
> only for states, DC and territories, so this job is not assessed for this
> place.

The limitation beneath it is unchanged: no other jurisdiction's rules or
coverage were substituted. The sentence does not cite the Pyramid Lake
record. That record shows one agent-run job in one tribal area; printing it
in another tribe's plan would read as coverage OpenPlan has not assessed.
`place-resolver-tribal-and-township.test.ts` holds the wording for a one-state
tribal area.

Blind category: the resolver gets no place kind, so the same sentence prints
for any place with no state on record, such as a multistate region.

## What a tribal-area row should be keyed by

Three keys were considered.

1. **The state the area lies in.** Rejected. It would answer for the Navajo
   Nation from Arizona's row, and a tribe's land-use and grant authority is
   not the state's. The November 1 work on tribal places already refused this
   (the Navajo test "leaves readiness unassessed rather than answering for
   Arizona").
2. **The Census AIANNH id.** Rejected as the first step. There are
   hundreds, a row per area per job would be inventory with no evidence, and
   the direction check requires every US jurisdiction id to be a known state,
   DC or territory.
3. **The place kind, as one national row per job.** Recommended. Add a
   jurisdiction `US-AIANNH` with `assessmentKind: "place-kind"`, five claims
   like any other, and teach the direction check that this one id is allowed.
   What OpenPlan can say is the same for every tribal area today: FARS covers
   fatal crashes where its coordinates fall inside the area; federal programs
   name tribal governments (the FY 2026 SS4A NOFO lists federally recognized
   Tribal governments as eligible and lets Tribal Transportation Program funds
   count as match); no tribal land-use plan bundle exists; no model
   validation covers one. A per-area row (key 2) can override the kind row
   later, for an area with its own evidence.

## The smallest honest change after this one

1. Pass the place kind to the resolver: add `kind` to
   `JurisdictionReadinessPlace`, read it from the declared entry
   (`tigerweb:aiannh`) and from the project's stored place kind. The legacy
   path reads `PROJECT_JURISDICTION_COLUMNS`, which about twenty routes,
   pages and tests project, so this is its own change with projection tests.
2. Add the `US-AIANNH` jurisdiction and its five claims, each citing the
   sources above, and allow the id in `product-direction-review.mjs`.
3. When the kind is `aiannh` and no state is on record, resolve the kind row.
   Never fall back to a state row.

Each step changes the readiness payload stored with v4 report packets, so a
saved tribal-area packet reads "changed" once, as any registry re-pin does.
No migration is needed for step 1: `projects.place_kind` already exists
(migration `20260728000009_project_place_of_record.sql`).
