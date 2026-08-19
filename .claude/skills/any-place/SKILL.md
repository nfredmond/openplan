---
name: any-place
description: Check that code works for any geography, not just the one in front of you. Use whenever code touches a place, jurisdiction, agency, boundary, bbox, FIPS or Census code, coordinate default, or a data source that only exists in one country.
---

# Any place

Product non-negotiable #0: **nothing is hardcoded, ever.** No place,
jurisdiction, agency, bbox, or FIPS code as a literal. Anything that varies
between users is configuration or data.

**The test:** could a planner in a different place, with different data, use this
without a code change?

Nathaniel enforces this by noticing, which means it is enforced only when he
happens to look. This skill is the check that runs anyway.

## The two floors

**It must work for anyone in the United States today**, and all of California is
the floor — never a single county, however convenient the pilot data is.

**The architecture must not assume the US**, because worldwide is the eventual
target. Anything country-specific — FIPS, Census and ACS, TIGERweb, KABCO, CCRS —
lives behind an adapter or a registry, never in a core type. Adding a
jurisdiction should mean adding a descriptor, not editing call sites.

If a core type has a field that only makes sense in one country, that is the
defect, even when every current user is in that country.

## What to look for

- **A literal that names somewhere.** A county, a state, a bbox, a FIPS code, a
  count of jurisdictions. A default map camera is allowed; the analysis geography
  always comes from the user.
- **A second front door.** Geography resolution has one path already —
  `src/lib/geographies/place-resolver.ts`, `/api/geographies/places`,
  `/api/geographies/place-boundary`, and `src/components/models/study-area-picker.tsx`.
  Reuse it. A second selector is how two places start disagreeing about what a
  place is.
- **A country-specific concept in a shared type.** Push it behind the adapter.
- **A data source assumed to exist.** Coverage differs by state and country; code
  that assumes a table, an API, or a vintage is available everywhere will fail
  silently somewhere else.

## Degrade honestly

**Geographic limits are disclosed, never silently applied.** An empty result must
never present as "nothing found here" when the truth is "we do not have data
there yet". Those are different sentences and a planner will act differently on
each.

Narrower capability is acceptable when it is labelled. Unlabelled narrow
capability is a false claim about coverage.

## Done when

- No literal in the change names a place, jurisdiction, agency, or boundary.
- The geography comes from the user through the existing front door, with no
  second selector introduced.
- Anything country-specific sits behind an adapter or registry rather than in a
  core type.
- Every limit the change introduces is disclosed on the surface a planner sees,
  and an empty result is distinguishable from an unsupported area.
