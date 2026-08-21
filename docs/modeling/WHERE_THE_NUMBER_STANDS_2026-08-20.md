# Where the corridor number stands — 2026-08-20

**A synthesis, not a new measurement.** Seven records landed on this day and a
reader arriving fresh would otherwise have to reconstruct the story from them.
It supersedes the stale parts of `MODELING_AUDIT_BRIEF_2026-08-18.md`, which
stays as written because it was true when written.

Every figure below links to the record that measured it. Where a number here
disagrees with an older document, this one is later; where an older document is
merely more detailed, it is still the authority on its own detail.

---

## The one-line answer

The screening model still puts roughly **1.7× too much traffic** on counted
roads. Three things that looked like causes were measured today and are not;
one contributor was sized; one long-standing "defect" turned out to be a
measurement artifact; and **the largest single term is still unexplained.**

## What was ruled OUT today

| candidate | verdict | record |
|---|---|---|
| Tertiary roads carry 0.07× because the model under-assigns them | **No.** It is network coverage: a third of collector links and 96–100% of local links receive no traffic at all, and count stations sit on them. | `UNLOADED_LINK_COVERAGE_2026-08-20.md` |
| Zone size makes the network a skeleton | **No.** Tripling the zone count buys 1.5 points of coverage against a pre-registered 5-point bar. | `ZONE_COVERAGE_REREAD_2026-08-20.md` |
| The model is missing local travel | **No.** Local streets carry 0.33× the published share on real links, but connectors carry another 7.1% of network vehicle-miles standing in for exactly that access travel. | `VMT_BY_CLASS_2026-08-20.md` |
| Seeding crossings from counts failed only because the through share was too low | **Not supported** at the share the evidence licenses. Seeding doubles vehicle-miles at either share. | `SEEDING_TIMES_PASSTHROUGH_2026-08-20.md` |

## What was sized

- **Concentration: about 1.10×.** The model loads a fifth of the network, so the
  travel that belongs on collectors and local streets is displaced upward onto
  the classes count stations sit on. Shares must sum to one, and the shortfall
  at the bottom (3.1 points collector, 4.7 points local) forces 1.10× onto the
  top three classes. Real, and it is not the cause.
- **Boundary disposition: a few points.** Moving Broomfield's pass-through share
  to its measured floor cut network vehicle-miles 10.4%, though the count
  improvement was concentrated in the three stations nearest the crossings.
  `PASSTHROUGH_AT_ITS_FLOOR_2026-08-20.md`.

**1.7 ÷ 1.10 leaves roughly 1.6× with no candidate cause.** That is the number
to beat, and nothing found today explains it.

## What the model can and cannot speak about

This is the part a planner needs and it is now measured rather than asserted.

- **77–85% of the road network inside a study area carries no assigned traffic**,
  in eleven counties across four states. By class: 3–7% of motorway and primary
  links are empty, against 34–69% of collectors and 96–100% of residential,
  service and unclassified streets.
- **A connector loads a path, not an area.** Loaded minor roads sit 2–9× closer
  to a centroid connector than unloaded ones, but even within a tenth of a mile
  of one, only 18.7% of minor links carry anything. Each connector attaches to a
  single node, so one route leads away from it.
- **Therefore the model cannot say anything about a minor road that is not on a
  connector's access path — about 95% of them.** That is the resolution of a
  screening model, not a defect, and adding connectors does not fix it: the
  block-group arm tripled them for 1.5 points.

Both count-validation lanes now report `stations_on_unloaded_links`, and the
county-run provenance document tells a planner what it means, because a station
on such a link scores exactly 100% error and **pulls a median toward 100 from
whichever side it sits** — flattering a bad run and penalising a good one.

## The boundary term, which is 61% of modelled vehicle-miles

Two flat guesses multiply into it: how much traffic crosses, and what share
passes through.

**The through share is now bounded from both sides by free data**, where the
data exists:

- **Floor** from LEHD LODES commute flows routed on FHWA's network. Broomfield
  0.54; Pueblo 0.20. Commute-only, so a floor on a floor.
- **Ceiling** from published count profiles. US-36 at Broomfield: 0.755.
- **The flat `GATEWAY_PASSTHROUGH_SHARE = 0.35` falls below both** at that
  crossing — the first time the band has excluded the default anywhere.

**And the ratio is not a constant.** Broomfield has 9× more commute
through-travel than long-distance; Pueblo has 1.2×. A 33-square-mile county
astride the Denver–Boulder corridor and a large isolated one cannot share one
national number.

**Why this is not yet actionable.** The floor is commute-only and known to sit
far below truth — at 0.54 a seeded Broomfield still terminates 272,000 vehicles
a day inside 33 square miles holding 75,000 people. The ceiling exists at one
crossing in six. Closing either gap needs data that free sources do not supply
today, and saying so is the deliverable.

## Nothing was adopted, and that is deliberate

`GATEWAY_PASSTHROUGH_SHARE` remains 0.35. Gateway seeding remains off.
`--zone-geography` remains tracts. Every one of those was pre-registered as
unchangeable by the experiment that tested it, before the experiment ran.

## What changed in the product

- The provenance document tells a planner how many counted roads the run put no
  traffic on, and what that does to the headline.
- `VALIDATION_RULES_VERSION` is 3; every figure stored before today reports a
  different quantity under the same name, and the app says so.
- A run's manifest records the pass-through share it applied — it did not, and
  two runs differing by 10% of vehicle-miles left no trace of which was which.
- The behavioral-demand engine description says what launching actually does on
  an instance with an ActivitySim runtime, which it has done since 2026-08-18.

## Where I would look next, in order

1. **The residual 1.6×.** No candidate. Everything large has been measured and
   the arithmetic above says the remainder is not concentration, not zone size,
   not trip length, not units, not boundary disposition.
2. **The crossing VOLUME**, the one boundary term never independently measured.
   Seeding shows counts improve and vehicle-miles worsen; that contradiction is
   unexplained and is the most concrete open thread.
3. **`OPENPLAN_MAX_GATEWAYS = 8`** while counties have 25–47 crossings —
   untouched today, and CLAUDE.md's ordering (fix the per-crossing figure before
   lifting the cap) is now partly satisfied.
