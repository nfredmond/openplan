# Integration verification and evidence limits

October 23, 2026. This record covers input preparation. It does not open the
TBI outcomes, execute the frozen study or establish behavioral accuracy.
The integration merges #379 and #382. The merge resolves only the competing
`docs/README.md` entries by keeping both. The preservation inventory records
117 unchanged files from the two dated study directories.

## Synthetic and source checks

The new bulk-Census, fare/coverage, WAC and retained-skim suites run 25 tests.
The existing transit suite runs 24; the 2019-profile and tour-fixture suites
run 11. The MTC adapter runs 50 tests with four explicit skips, leaving 46
passed tests. Its skipped stock checks expect an environment inside this
checkout; the actual native interpreter lives in the main checkout. Those
skips concern stock person coding, skim inventory, overlay columns and config
resolution. The TypeScript population registry runs 34 tests with Vitest
`--pool=forks --maxWorkers=2`. None reads TBI outcome records.

The three mutation campaigns contain 48 controls: four harmless changes
survive and 44 targeted wrong behaviors reach assertion failures. Each campaign
restores the exact source hash. The ledgers and individual logs reside in
`integration-evidence/`. These controls cover decoding, membership, uniqueness,
coverage, source binding, fare periods, missingness, employment conservation and
retained-file copying. They do not test source truth, historical service
completeness, road safety, pedestrian barriers or behavioral validity.

## Retained failures and corrections

- The bare CPython 3.11 interpreter lacks `requests`. Acquisition uses the
  existing CPython 3.11 ActivitySim environment instead.
- The Census lookup is CP1252, not UTF-8. The decoder now uses its actual
  encoding. The real sequence files retain estimates and margins.
- A `.response` ZIP path was not accepted by GeoPandas's ZIP URI handler.
  Passing the retained ZIP bytes reads the published geometry successfully.
- The first population attempt supplied Minnesota only, while the existing
  resolver selects three Wisconsin PUMAs too. The owned incomplete attempt
  was stopped. The corrected attempt supplies both states and a PUMA-coverage
  guard. No population from the incomplete attempt is admitted.
- Historical Overpass POST attempts returned HTTP 406 and HTTP 504. Their
  responses and logs remain retained. The same dated query succeeds through
  GET and produces the road skims. No current-road fallback is substituted.
- Vitest initially had no local dependencies. `npm exec` selected an external
  Vitest and failed startup before any tests. `npm ci --ignore-scripts` installed
  this checkout's lockfile, then the scoped suite passed. Installation reports
  one high-severity advisory; this lane does not change dependencies or run an
  automatic audit fix.
- An indexed 2019 State Fair schedule and an indexed 2020 Title VI document
  return HTTP 404 at their original URLs. They are not claimed as retained
  fare evidence. The retained Council fare resolution, history and analysis
  provide the fare-policy evidence.
- Initial mutation controls that produced incidental errors were not accepted
  as successful controls. The retained final campaigns require assertion
  failures. Initial logs and ledgers remain separate.
- An input-summary audit initially tried to parse the published `.` missing
  marker as a float. The corrected audit uses the existing missing-value
  decoder. Four median-income cells stay unavailable; no source or fitting
  rule changes.
- A full staged whitespace check reports trailing spaces in captured command
  logs. The source and authored-document check passes. Raw log bytes remain
  intact; the full check is not reported as clean.

## Native preparation boundary

Population synthesis, highway construction, transit routing, skim expansion
and model execution each use the requested 6 GiB memory limit and zero swap.
A scope snapshot confirms `MemoryMax=6442450944` and `MemorySwapMax=0` for the
initial native jobs. Time logs record each process's completion and peak RSS.
AequilibraE supplies road impedance only. No demand assignment, validation
comparison or engine averaging runs.

The MTC skim expansion runs in a separate process to avoid holding its arrays
beside the full population. The bundle recipe calls the existing builder with
a process-local copy adapter for that stage. The adapter verifies the complete
input request, source and implementation hashes, stock digest, both output
hashes and sizes, and new destination paths. It copies the exact native-expanded
OMX and NPZ. This is supplied-artifact custody, not producer authentication.
The installed packages and normal builder defaults remain unchanged.

The full model recipes use identical runtime memory settings in both arms:
adaptive chunking, a 4.5-billion-byte target, 100 initial chooser rows, one
process and all households. These settings are explicit study runtime settings,
not a household sample or a coefficient change. The named candidate reproduces
all 27 frozen substitutions and the original candidate hash. No outcome
opening is implied by preparing those recipes. The readiness report records
whether each native stage actually completes.
