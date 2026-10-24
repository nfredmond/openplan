# Population convergence and chunking preparation, October 24, 2026 UTC

This additive preparation keeps TBI outcomes closed. It preserves the original
split, prior input archives, failed runs, frozen study and unapplied migration.
The lead authorizes a 9 GiB scope with zero swap and one heavy job at a time.
No Docker stack or hosted service changes. Accuracy takes priority over runtime.

## Population diagnosis and explicit method

The four household controls have identical totals in all 704 source tracts:
B11016 (household size), B19001 (income), B25044 (vehicles) and B08202 (workers).
No positive target lacks a category in the 70,980-household regional seed.
The same seed contains 1,871 distinct control patterns. The existing pipeline
pools the 32 selected PUMAs; it does not allocate a different PUMA seed to each
tract. This remains a geographic representativeness limitation, not a missing
PUMA correction. All source bytes and the admitted 2015–2019 profile remain fixed.

The legacy IPU loop applies the same multiplier to every household touching a
person-age category. Household contributions to that category differ. The loop
can cycle despite feasible controls. The worst prior zone, 515, has a feasible
nonnegative solution but a retained 0.377172 residual. An entropy-balancing probe
reaches the unchanged 0.001 tolerance in 55 passes. No target is rescaled to fit.

The explicit `entropy` option minimizes relative entropy from the seed weights
by coordinate updates. For contribution `a`, each update uses
`w_new = w_old * exp(lambda * a)` and solves
`sum(a * w_old * exp(lambda * a)) = target`. Equal control patterns share their
multiplier; household weights within a pattern retain their seed proportions.
A published zero sets all contributing weights to zero. A conflicting positive
control remains failed. The existing IPU default remains unchanged.

The study declares a 2,000-pass computation limit, retaining the 0.001 convergence
tolerance and every published margin. This increases computation, not acceptance
tolerance. Of 700 feasible zones, 25 need more than 200 passes; the maximum is
827. Four zones have zero household population and converge to zero. All 700
feasible fractional fits pass both gates. Four source-inconsistent fits remain
failed. Their fitted synthetic residents are excluded explicitly, and both arms
use the same geographic exclusion in addition to the prior 66-zone MVTA mask.
The parent preserves all 704 source zones and their diagnostics.

## Integer realization needs a separate correction

The original archive has 6,462 realized-control margin violations in all 700
populated zones. Its reported 30 out-of-margin zones describe fractional fitted
weights, not the expanded household rows. The first entropy realization retains
1,178,063 households and 3,373,412 persons, but the same individual-record
largest-remainder step produces 7,632 margin violations in all 696 retained
populated zones. That attempted realization and its exact source closure remain
under `common_population.failed-integerization` and `unbalanced-source`.
It is not admitted to ActivitySim.

The explicit `controlled` integerization option groups identical control
patterns and minimizes absolute rounding distance from their fitted counts.
An integer program requires the exact published household total and every
unchanged published margin bound. Structural zero patterns stay zero. It has no
time limit or positive optimality-gap allowance. Whole seed households then
receive each solved pattern count in their fitted proportions, using deterministic
largest remainders within that pattern. No person is invented or sampled away.
The implementation checks realized counts against the bounds independently of
the optimizer's success flag. A failure raises; it does not silently exclude an
otherwise feasible zone. The normal largest-remainder default remains unchanged.

The controlled rebuild reuses only the hash-verified fractional diagnostics of
this owned entropy attempt. It verifies the retained manifest, diagnostic bytes,
public source files, Census adapter, bulk adapter and entropy implementation.
It changes integer realization, not fractional targets, weights or gates.
The final result record reports its new realized counts and any margin failures.

## Four source inconsistencies remain excluded

The retained ACS sequence cells give these exact arithmetic contradictions.
B11016 reports zero five-, six- and seven-or-more-person households in each
listed tract. Its household-size cells therefore imply an exact person total.
B09019_002E gives a different household-resident total. B01001 age categories
are scaled by B09019_002E / B01003_001E under the inherited adapter. This scaling
retains the household-resident total; it does not repair the source conflict.

| Zone | Tract GEOID | B11016 implied residents | B09019_002E residents | Difference | Published households |
|---|---|---:|---:|---:|---:|
| 439 | 27053104400 | 1,582 | 1,628 | 46 | 1,225 |
| 443 | 27053105201 | 3,077 | 3,114 | 37 | 2,099 |
| 444 | 27053105204 | 2,583 | 2,664 | 81 | 1,904 |
| 494 | 27053126100 | 6,731 | 6,795 | 64 | 4,494 |

These four zones contain 9,722 published households and 14,201 published
household residents. They remain failed even though their fractional residuals
fall within the published margins. Exact control feasibility and margin grading
remain separate gates. The coarse four-plus control also cannot bridge the
remaining gaps in zones 439 and 494 with the retained seed's maximum size of 15.
No enlarged household, invented person, reconciled source total or relaxed gate
substitutes for the conflict.

Sources are the retained Census [2019 summary sequences](https://www2.census.gov/programs-surveys/acs/summary_file/2019/data/5_year_seq_by_state/Minnesota/Tracts_Block_Groups_Only/)
and [sequence lookup](https://www2.census.gov/programs-surveys/acs/summary_file/2019/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt).
The exact source-control file SHA-256 is
`53664d61c8fc820e252324b635cfefe7fb5cf45e3b8001ecd260fdebab5b2661`.
The zone-level prior and corrected diagnostics are in `convergence-evidence/`.
The LP audit proves feasibility over retained seed patterns, not population
accuracy. Integer realization and native model completion require separate checks.

## Chunking protocol, declared before parity runs

The installed engine is ActivitySim 1.5.1. Its [version-tagged chunking documentation](https://github.com/ActivitySim/activitysim/blob/v1.5.1/docs/users-guide/performance/chunking.md)
describes dynamic training, a retained `chunk_cache.csv`, then production use.
The exact documentation bytes are retained. Production silently falls back to
training if its cache is absent, so this preparation must verify the cache before
launch and inspect logs for fallback. No custom logsum batching enters either arm.
The prior allocator wrapper is not needed to define the chunking protocol.

First freeze a small deterministic subset of complete synthetic households from
the corrected runtime bundle. Keep the full retained zone and skim domain.
Run the same subset through unchunked, training and production configurations
with the same seed, coefficients, input tables and model sequence. Require every
final table to have identical values, with exact float comparison. Byte equality
is stronger and will be recorded when it holds. The seven compared model tables are accessibility, land use, households,
persons, tours, trips and joint-tour participants. Operational checkpoint
timestamps remain in pipeline metadata and are explicitly omitted from model
table exports in every configuration. Verify that chunking actually splits
chooser rows. Any parity failure stops further model execution and returns
the retained discrepancy to the lead. No rounding tolerance or omitted final
column may turn a mismatch into parity.

After parity passes, run both full-population arms sequentially under
`systemd-run --user --scope -p MemoryMax=9G -p MemorySwapMax=0`, using CPython
3.11 and the admitted built-in chunk settings. Retain training caches, scope
peaks, elapsed time, final-table hashes, tour counts and MODELED shares only.
Runtime success does not resolve historical travel conditions, observation
mapping, estimands or the lead-owned frozen opening.

The subset uses the lowest 64 SHA-256 values of
`tbi2019-chunk-parity-v1:household_id`, with every member of each selected
household. It retains the full 634-zone runtime domain and all corresponding
skims. Both coefficient arms use seed 0. Unchunked settings use `disabled` and
chunk size 0; training and production use a 1,000,000,000-byte target and two
initial chooser rows to exercise splitting. The declared full-run target is
5,500,000,000 bytes with 100 initial rows, all retained households and one process.
Each arm trains its own full-run cache before production. These are explicit
runtime settings, not new engine or worker defaults.
