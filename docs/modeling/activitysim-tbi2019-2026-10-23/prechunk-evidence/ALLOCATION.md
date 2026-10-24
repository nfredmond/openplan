# Allocation measurements before inner grade-school chunking

All sizes below describe the 20,000-household diagnostic. It contains 49,094
persons, all 634 destinations and 205,048 sampled grade-school location rows.
`baseline-20000.profile.jsonl.gz` retains every field's dtype and storage;
`baseline-allocation-summary.json` contains the selected boundaries. The
instrument reads metadata only. No ActivitySim source file changes.

Bytes are pandas deep accounting with the index included unless stated
otherwise. Shared indexes, buffers and Python objects can appear in multiple
entries. These entries are not disjoint physical allocations and must not be
summed as RSS. Categories in the prepared chooser table are the engine's
existing period labels. No dtype reduction enters this diagnostic.

| Live table or array | Rows | Columns | Dtypes, column counts | Deep bytes | Installed ActivitySim source |
|---|---:|---:|---|---:|---|
| Households | 20,000 | 24 | int64 9; float64 3; int8 8; bool 4 | 2,848,424 | `abm/tables/households.py:24-137`; household annotations |
| Persons | 49,094 | 30 | int64 8; float64 1; int8 1; bool 20 | 6,015,302 | `abm/tables/persons.py:19-79`; person annotations |
| Persons merged | 49,094 | 92 | int64 32; float64 26; int8 9; bool 25 | 25,898,372 | `abm/tables/persons.py:79-112` |
| Land use | 634 | 29 | int64 16; float64 12; bool 1 | 164,274 | `core/input.py:61-221`; land-use annotations |
| Accessibility | 634 | 10 | float64 10 | 55,792 | `abm/models/accessibility.py:160-183` |
| Size-term definitions | 22 | 12 | object 1; float64 11 | 5,337 | `abm/tables/shadow_pricing.py:1376` |
| School destination size | 634 | 3 | float64 3 | 36,840 | `abm/tables/shadow_pricing.py:1289-1430` |
| Workplace destination size | 634 | 4 | float64 4 | 41,912 | Same size-table construction |
| Grade-school sampled locations | 205,048 | 3 | int32 1; float32 1; uint32 1 | 4,100,960 | `abm/models/location_choice.py:790-822` |
| Joined logsum choosers, before preprocessing | 205,048 | 12 | int64 5; float64 2; bool 2; int32/float32/uint32 1 each | 15,993,744 | `abm/models/location_choice.py:558-565` |
| Batched random draws | 205,048 | 6 | float64 6 | 19,936,872 | `core/assign.py:310-329`; `core/random.py:658-670` |
| Preprocessor result DataFrame | 205,048 | 65 | int64 11; float64 23; float32 3; bool 28 | 74,069,544 | `core/assign.py:463-473`; `core/util.py:484-498` |
| Prepared logsum choosers | 205,048 | 80 | int64 17; float64 25; float32 4; bool 30; category 2; int32/uint32 1 each | 90,474,318 | `core/expressions.py:173-177`; `abm/models/util/logsums.py:247-267` |

Shadow pricing is disabled by stock `settings.yaml:110`. There is no allocated
shadow-price matrix. The calculator retains the 634 by 3 desired-size frame
shown above, three empty three-row diagnostic frames (310 deep bytes each),
and two empty frames (132 bytes each). Shared arrays are absent in this
single-process path. This is a configured absence, not an unmeasured zero-size
active shadow-pricing calculation. The constructor's disabled branch is at
`abm/tables/shadow_pricing.py:284-293`.

At `assign.py:463`, 65 result Series hold 63,974,976 payload bytes, excluding
indexes. They comprise 18,044,224 integer bytes, 37,728,832 float64 bytes,
2,460,576 float32 bytes and 5,741,344 Boolean bytes. Random draws and temporary
Series remain live in the assignment frame. `df_from_dict` then constructs a
second DataFrame from that dictionary. Boundary RSS rises from 658,747,392 to
722,731,008 bytes during that call. Shorter internal peaks are not measured by
these two boundary values.

The joined table exists before preprocessing. Preprocessing computes all
columns and constructs the complete result frame before applying the integer
optimization and before calling the inner simulator. That order explains why
reducing the inner chunk target does not bound these allocations. The full-run
trace separately resolves which allocation reaches the cap; the diagnostic
alone does not identify the historical kernel-kill line.

## Full-population stop at 9 GiB

The instrumented current arm retains all 1,060,601 households and 2,617,177
persons. It reaches 10,717,604 sampled grade-school rows. The join completes.
The failed allocation boundary is later, while the assignment evaluator retains
full-length preprocessing results and temporaries. The last completed trace
entry is `core/assign.py:349`, with target `sov_available`. The next expression
is `(odt_skims['SOV_TIME']>0) & (dot_skims['SOV_TIME']>0)`, from the stock
preprocessor CSV at line 72, evaluated at `core/assign.py:397`.

At that boundary, 46 result vectors already occupy 3,065,234,744 payload bytes,
excluding indexes. The evaluator also retains temporary vectors and its random
draws. The 65-column result DataFrame constructor has not been reached. This
supersedes any inference that this full attempt fails in the join or in the
later result-frame assembly. The exact native allocation instruction inside
the pending expression is not captured. No narrower malloc-level claim follows.

| Full-population allocation | Rows | Columns | Dtypes, column counts | Deep bytes or stated payload bytes |
|---|---:|---:|---|---:|
| Households | 1,060,601 | 24 | int64 9; float64 3; int8 8; bool 4 | 156,846,332 |
| Persons | 2,617,177 | 30 | int64 8; float64 1; int8 1; bool 20 | 331,968,069 |
| Persons merged | 2,617,177 | 92 | int64 32; float64 26; int8 9; bool 25 | 1,391,924,754 |
| Land use | 634 | 29 | int64 16; float64 12; bool 1 | 164,274 |
| Accessibility | 634 | 10 | float64 10 | 55,792 |
| Size-term definitions | 22 | 12 | object 1; float64 11 | 5,337 |
| School destination size | 634 | 3 | float64 3 | 36,840 |
| Workplace destination size | 634 | 4 | float64 4 | 41,912 |
| Sampled locations | 10,717,604 | 3 | int32, float32, uint32 | 214,352,080 |
| Joined choosers | 10,717,604 | 12 | Same dtypes as the diagnostic join | 835,973,112 |
| Choosers after period/duration columns, before result assignment | 10,717,604 | 15 | Join plus two categories and int64 duration | 976,966,702 |
| Batched random draws | 10,717,604 | 6 | float64 6 | 634,002,440 |
| Retained result vectors, not yet a DataFrame | 10,717,604 | 46 | float64 23; int64 10; bool 10; float32 3 | 3,065,234,744 payload |

The same source lines in the diagnostic table construct these full objects.
The school shadow-price matrix remains absent because shadow pricing is false.
`full-allocation-summary.json` retains per-column bytes, indexes, local tables,
result vectors and temporaries, without model-record values.

The final trace reports process RSS of 9,214,271,488 bytes. The last one-second
scope sample reports 9,576,824,832 anonymous bytes and 12,283,904 file-cache
bytes. An outside observer then retains the kernel `memory.peak` counter of
9,663,676,416 bytes, `oom 1`, `oom_kill 1`, and zero swap peak before scope
removal. The systemd journal independently reports `oom-kill`. The in-scope
terminal health receipt is absent and remains absent.

The instrumented attempt lasts 1,160.959 seconds by the outer controller.
Tracing overhead makes this unsuitable as an uninstrumented runtime benchmark.
The sampled stage peaks are 1,714,835,456 bytes for land-use initialization,
5,267,734,528 for household initialization, 3,566,059,520 for accessibility,
and 9,613,721,600 for school location. They are one-second lower bounds,
separate from the retained kernel lifetime counter.

No full suffix or SEMCOG full attempt follows this resource stop. No full final
table, tour/trip count or MODELED share exists. The tested path needs more than
9 GiB; its uncapped peak and later stages remain unmeasured. No additional model
run, memory-cap increase or Docker operation occurs after this failure.
