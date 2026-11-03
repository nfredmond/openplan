# Twin Cities timetable plausibility result

The final run completes on the retained October 5, 2019 Metro Transit feed,
using Tuesday, October 8, 2019 service. It computes 8,782 active trips across
the 704-zone, seven-county Census 2019 tract preparation system. It reads no
observed travel choices and executes no ActivitySim or AequilibraE demand model.

Of 704 zone internal points, 459 (65.2 percent) fall within the declared
800-meter walk-access radius of a served stop. The remaining 245 have no
centroid walk access under that rule. This measures point proximity, not the
share of residents who can reach transit over a pedestrian network.

There are 494,912 possible directed interzonal pairs. The following figures
describe generic walk-transit paths reachable within 180 minutes. Percentiles
exclude unreachable pairs and the diagonal, so the journey cap truncates them.
They are plausibility checks only.

- EA, 04:00:00 departure: 92,787 pairs (18.7 percent of all pairs); 447 origins reach another zone. Door-to-door P50/P90/P95: 135.5/170.4/174.7 minutes.
- AM, 08:00:00 departure: 129,728 pairs (26.2 percent of all pairs); 393 origins reach another zone. Door-to-door P50/P90/P95: 101.7/156.9/166.6 minutes.
- MD, 12:00:00 departure: 120,996 pairs (24.4 percent of all pairs); 382 origins reach another zone. Door-to-door P50/P90/P95: 105.7/161.9/169.6 minutes.
- PM, 16:00:00 departure: 144,300 pairs (29.2 percent of all pairs); 434 origins reach another zone. Door-to-door P50/P90/P95: 105.2/155.5/166.4 minutes.
- EV, 20:00:00 departure: 94,507 pairs (19.1 percent of all pairs); 342 origins reach another zone. Door-to-door P50/P90/P95: 102.8/158.4/168.0 minutes.

The result is `los_only_fare_unavailable`. Every reachable pair lacks a
supported fare, so these paths do not enable the stock mode-choice alternatives.
Drive-transit remains unavailable because no sourced directional drive
connectors are supplied. The archived feed excludes MVTA. Standard GTFS bus
types map to LOC; no agency-sourced express-route classification is supplied.

The complete raw masks and components remain in the local artifact identified
by [regional-summary.json](evidence/regional-summary.json). The raw NPZ is about
22 MB compressed and is not committed. Its source URLs and hashes support a
repeat download and run. The final raw artifact is byte-identical to the first
regional run, which preceded metadata-only additions. Both run records remain.

Artifact SHA-256: `00a2224d8254d6cbd5a701b22387fbcc604ba60c84c0d8478c5807ee06ae66cd`.

Implementation SHA-256: `db2e85963579cac7c78148561393b9c5870ed905c0cf3e53214236f5468df3a6`.

The final invocation uses the 6 GiB memory scope and no swap. Its wall time,
peak resident memory, and successful exit appear in
[twin-cities.log](evidence/twin-cities.log). The source record carries CPython
3.11.15, NumPy 1.25.2, and SciPy 1.16.3.

This result does not resolve the frozen study's other multimodal admission
requirements. It does not establish service completeness, fare or parking
conditions, pedestrian access, period-average impedance, or behavioral accuracy.
