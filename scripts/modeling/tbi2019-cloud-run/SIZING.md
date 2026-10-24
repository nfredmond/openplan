# Sizing the first cloud attempt

October 24, 2026. Recommend **128 GB RAM and four household processes**.
For a 64 GB machine, retain **four processes**, but treat it as a lower-confidence
attempt. Neither allocation guarantees completion. Do not raise the process
count: four is the retained choice-parity configuration, and extra workers
replicate fixed overhead. Both arms run sequentially.

The corrected archive contains 1,060,601 households, 2,617,177 persons and 634
zones. The older 1,100,948-household population is superseded. Each of four
workers receives at most 265,151 households. Production chunk targets remain
268,435,456 bytes per worker. The suffix uses one process and no chunking.

## What the retained measurements establish

The single-process hybrid path completes school location at a 16 GiB cap, then
fails during workplace high-income logsum preparation after 3,231.9 seconds.
The four-process path fails during grade-school logsum preparation after 287.9
seconds at the same aggregate cap. These are censored peaks, not upper bounds.
The previous 15.90 GB forecast is disproved and must not be reused.

The file-backed skim payload is `826 * 634 * 634 * 4 = 1,328,062,624` bytes,
or 1.237 GiB. Count this once in aggregate capacity accounting. Process RSS
can count the same mapped pages repeatedly. Disk page cache and RSS also overlap.
The recorded matrices are float32 already; this package performs no downcast.

The attached `sizing-observations.json` preserves sampled process RSS by stage
for both 2,000-household hybrid arms and the four-process SEMCOG arm, plus the
failed full-run observations. One-second samples miss short peaks. The process
VmHWM values are observations before exit, not guaranteed terminal maxima.

For the single-process 2,000-household current arm, RSS rises from 337.3 MB at
startup to 534.9 MB in school, 536.6 MB in workplace, 552.5 MB in mandatory tours,
555.3 MB in nonmandatory tours and 564.6 MB in trip destination. The SEMCOG
prefix reaches 572.3 MB. Initial skim loading separately reaches 1.80 GB.
The unchunked current suffix rises from 294.1 MB to 486.6 MB in scheduling
and 507.6 MB in mode choice. SEMCOG reaches 507.3 MB. Full-scale later steps
and the suffix have never been measured.

In the four-process SEMCOG fixture, each worker handles 500 households. School
RSS reaches 374.3–386.4 MB; workplace reaches 386.0–389.9 MB; later prefix steps
reach 452.0–464.7 MB. Observed worker VmHWM reaches 476.6 MB. Coalescence sees
375.8 MB in the parent in the sampled process record; an isolated coalescence aggregate peak is unavailable. Full initialization
reaches 4.888 GB observed VmHWM; apportionment reaches 1.572 GB. At the failed
full school boundary, worker RSS reaches 4.634, 4.629, 4.249 and 4.010 GB.
The largest worker VmHWM reaches 4.763 GB. Coalescence is not reached.

## Per-step growth limits

All figures below are sampled process RSS in decimal MB, unless marked VmHWM.
The hybrid column is one process with 2,000 households. The sliced column is
the maximum across four 500-household SEMCOG workers. Values are not mutually
additive. The two arms have different modeled activity, so this is a sizing
comparison, not an accuracy comparison or a controlled slope experiment.

| Step | Hybrid current / SEMCOG, MB | Sliced worker, MB | Full evidence and usable growth estimate |
|---|---:|---:|---|
| School location | 534.9 / 539.4 | 386.4 | Largest worker VmHWM 4,763.1 MB at 265,151 households; censored slope 16,196.9 bytes per additional household. |
| Workplace location | 536.6 / 539.4 | 389.9 | Single full process exceeds 16 GiB aggregate; no completed full-worker slope. |
| CDAP | 538.2 / 544.2 | Included in later-prefix maximum below | Full step not reached; growth unmeasured. |
| Mandatory tours | 552.5 / 559.0 | Included below | Full step not reached; growth unmeasured. |
| Joint tours | 553.1 / 558.6 | Included below | Full step not reached; growth unmeasured. |
| Nonmandatory tours | 555.3 / 559.2 | Included below | Full step not reached; growth unmeasured. |
| Tour mode choice | 549.7 / 559.6 | Included below | Full step not reached; growth unmeasured. |
| At-work subtours | 561.4 / 569.1 | Included below | Full step not reached; growth unmeasured. |
| Stop frequency | 551.9 / 557.5 | Included below | Full step not reached; growth unmeasured. |
| Trip purpose/destination | 564.6 / 572.3 | Later-prefix maximum 464.7 | Full step not reached; no isolated sliced step slope. |
| Coalescence | Not applicable | Parent 375.8 | Full step not reached; 16 GiB reserve is an assumption. |
| Unchunked trip scheduling | 486.6 / 483.7 | Unsliced suffix | Current startup-subtracted screen 96,254.0 bytes per household. |
| Unchunked trip mode choice | 507.6 / 507.3 | Unsliced suffix | Current startup-subtracted screen 106,725.4 bytes per household. |

The retained four-process summary groups later steps as `other_model_steps`.
It does not support assigning its pooled maximum to each individual step.
The package's new raw telemetry preserves the full labels for future analysis.
None of the full-population post-workplace steps has a measured per-worker
growth rate. Treat these missing rates as unavailable, not zero.

## Arithmetic and uncertainty

A censored per-worker school slope is
`(4,763,111,424 - 476,594,176) / (265,151 - 500) = 16,196.9 bytes/household`.
It is at least about 1.90 times the earlier 8,526.8-byte proxy. The slope still
misses the allocation that caused the kill. Four times the largest observed
full worker is 19.05 GB, already larger than the 17.18 GB aggregate cap because
process peaks are asynchronous and shared RSS overlaps. It is a reservation
proxy, not a physical allocation sum.

For capacity planning, reserve **8 GiB per worker** for the prefix: four workers
use 32 GiB, plus 1.237 GiB skims and 2 GiB parent/monitor allowance gives
35.237 GiB. The 8 GiB reservation is an explicit engineering allowance,
roughly 1.8 times the largest censored worker VmHWM, not an observed upper bound.
A 64 GB decimal machine has 59.60 GiB, leaving 24.37 GiB above that reservation;
128 GB has 119.21 GiB, leaving 83.97 GiB. Keep the actual container limit explicit.

Coalescence follows worker completion. Reserve 16 GiB for concat/copy, checkpoint
I/O and retained tables, plus the 2 GiB parent allowance and 1.237 GiB cache.
This 19.237 GiB allowance is unvalidated. The subset's 375.8 MB parent does not
identify a full-population per-household slope, so linear scaling of that whole
number would mistake fixed interpreter overhead for table growth.

The **unchunked suffix is the largest unmeasured risk**. A deliberately cautious
screen subtracts startup RSS from the current 2,000-household mode-choice peak:
`(507,572,224 - 294,121,472) / 2,000 = 106,725.4 bytes/household`.
At full population that gives `294,121,472 + 106,725.4 * 1,060,601 =
113.49 GB` (105.70 GiB), before a 2 GiB operating allowance. This extrapolation
mixes fixed and variable allocations and is not a validated forecast. It does
show why 64 GB is not a safe recommendation from the available evidence, and
why 128 GB is preferred. A 128 GB limit leaves about 11.5 GiB against this
screen after the allowance. Larger transient copies could still exceed it.
The analogous trip-scheduling screen is 102.38 GB. No change to the suffix's
legacy retry cohorts is permitted to make it fit.

## Elapsed time

The four-process subset prefix takes 140.7–144.8 seconds and its suffix takes
10.8–11.2 seconds. The population ratio is `1,060,601 / 2,000 = 530.3005`.
Straight scaling gives 20.7–21.3 hours for the prefix plus 1.59–1.65 hours for
the suffix, about 22–23 hours per arm. The single-process allocator subset
prefix takes about 160 seconds, whose same screen is 23.6 hours before suffix.
Fixed startup/skim costs inflate these screens; small-slice single-chunk
behavior, full-scale chunk pressure, checkpoint writes and CPU differences can
move timing in either direction. Budget **12–48 hours per arm, 24–96 hours for
both**, plus transfer time, with low confidence. This is a planning range,
not a deadline or a scientific acceptance condition. Require at least four
usable CPU cores; BLAS/OMP threads remain one per process.

School and workplace preprocessing dominate the measured memory failures.
Mandatory scheduling and trip destination dominate substantial portions of the
subset prefix runtime. Coalescence, the complete unsliced scheduling suffix,
checkpoint disk use and all later full-population peaks remain unmeasured.
Reserve at least 100 GB writable disk for the first cloud attempt and monitor
free space. This is an operational allowance, not a measured full-run maximum.
