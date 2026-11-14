# ActivitySim TBI 2019 attempt, archived October 24, 2026

Recorded November 14, 2026. Pull requests 379 and 384 prepared an ActivitySim
comparison against the Twin Cities 2019 Travel Behavior Inventory (TBI). Neither
reached a full-population model run, and both are being closed without merging.
This note records what they found and where their work is kept. It makes no
accuracy or acceptance claim.

## Where the work is kept

The annotated tag `archive/s2-tbi2019-integration-20261024` points at commit
`6361a3965`, the final head of PR 384. That commit contains commit `828efa0e6`,
the final head of PR 379. The tag is the only place on GitHub that preserves
either branch's files. Read the study records with
`git show archive/s2-tbi2019-integration-20261024:<path>`, starting with
`docs/modeling/activitysim-tbi2019-2026-10-23/INTEGRATION_READINESS.md`.

The runtime input archive has 515 inventoried files, 2,898,724,157 bytes and
SHA-256 `81fe67cc0ad74454dfd5a94c21d2497e6236c4958e7581e1f6babaff5d1fafd7`.
It held public inputs only, with no TBI outcomes or modeled travel tables. The
tagged records name its local path on the machine that built it. On November 14,
2026 neither that archive nor the private evidence archive was present on the
current Windows machine, so a successor may need to rebuild inputs from the
tagged recipes.

## The held-out households remain untouched

No TBI outcome field was requested, read or compared in either pull request.
The frozen household split stays 7,516 households: 6,019 development and 1,497
held out. The 1,497 held-out households were never opened and remain available
for a future frozen opening.

## Four lead decisions came before any run

The integration preregistration addendum
(`INTEGRATION_PREREGISTRATION_ADDENDUM.md` in the tag) recorded four lead
decisions on October 23, 2026, before outcome access:

1. **Day weights.** The primary estimator assigns the published TBI `day_weight`
   to each eligible tour in that day. A trip-weighted mode-share sensitivity runs
   beside it, and the two are never combined.
2. **Cited 2019 fares.** Only authoritative Metro Transit or Metropolitan Council
   fare policy is admitted, with source bytes and effective dates. The October 1,
   2017 adult fares, which Council records show still in effect in 2019, price
   single boardings on 79 express routes and three tram routes. The other 106
   route fares, transfers and other fare products remain unavailable, with no
   flat-fare guess.
3. **MVTA exclusion.** No freely retrievable 2019 Minnesota Valley Transit
   Authority (MVTA) feed was found. The published member-city area defines a
   geographic exclusion instead of treating MVTA as zero service.
4. **Drive connectors.** Drive-to-transit connectors may come only from published
   park-and-ride locations joined to the admitted highway network. The 2019
   inventory lacked a verified entrance-to-stop crosswalk, so drive-to-transit
   stayed unavailable with zero connectors.

## Population fit and runtime geography

The study region has 704 zones. The explicit entropy fitter resolved 673 of the
677 earlier nonconverged zone fits under the unchanged 0.001 tolerance. Zones
439, 443, 444 and 494 still fail because their published household-size cells
(ACS table B11016) imply different resident totals than ACS B09019_002E, and
they stay excluded. The MVTA
exclusion removes another 66 zones, including their households and destinations.
The runtime population therefore covers 634 zones, 1,060,601 households and
2,617,177 persons.

## Chunked runs differ because of trip scheduling retries

A 64-household fixture produced different trip departures with ActivitySim's
built-in chunking than without it. The cause is ActivitySim 1.5.1
`trip_scheduling` retry grouping. Failed legs are retried inside each chunk, and
time bounds for an inbound leg depend on whether any outbound leg in the same
chunk is still failing. Under the inherited logic version 1, a different chunk
composition changes which retry succeeds. The selected path chunks through
`trip_purpose_and_destination`, then resumes from that checkpoint with chunking
disabled for `trip_scheduling` and every later step. The tagged
`chunk-cause-evidence/ROOT_CAUSE.md` keeps the trace.

## Memory blocked every full run

Under a 9 GiB cap with no swap, all four full-population prefix attempts were
killed for memory during grade-school location choice. Each reached about
9.5 GB of anonymous memory (9,491,968,000 to 9,560,707,072 bytes in the last
samples) while building 10,717,604 sampled-location rows, before ActivitySim's
inner logsum chunker started. No full-population tour, trip or mode share exists.

The tagged sizing note (`scripts/modeling/tbi2019-cloud-run/SIZING.md`)
recommends 128 GB of RAM and four household processes for a first attempt. That
figure reserves 8 GiB per worker as an engineering allowance, not a measured
upper bound, and does not guarantee completion.

## Code that exists only in the tag

PR 384 added route-period single-boarding fares (`route_period_single_boarding`)
and source-backed coverage exclusions (`coverage_exclusions`) to
`scripts/modeling/activitysim_transit_skims.py`. PR 379 added a 2019 CPI-U
annual value of 255.657 to `scripts/modeling/activitysim_mtc_inputs.py`, cited to
the Bureau of Labor Statistics February 2020 historical table. None of this code
is on main. A successor must take it from the tag.

## What a successor must do

A successor that revives this study must:

- re-time migration `20261023224145_population_profile_2019.sql` so its
  timestamp falls after main's latest migration, then follow the migration
  rollout order in `AGENTS.md`;
- obtain the compute the full runs need. The run would need paid compute that
  nobody has authorized, and OpenPlan uses no paid services.

Until both happen, the TBI comparison remains unrun and the held-out households
remain unopened.
