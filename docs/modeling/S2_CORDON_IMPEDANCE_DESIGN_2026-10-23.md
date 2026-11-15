# Test the distribution of terminating external trips

Status: development design, before candidate outcomes.

Choose one candidate, `cordon_impedance_v1`. Condition external-to-internal and
internal-to-external trips on the retained network's free-flow travel times.
Keep their row and column totals fixed through iterative proportional fitting.
Leave internal-to-internal and gateway-to-gateway cells unchanged. This tests
spatial distribution, with no volume scalar or new observed-demand claim.

The August 17 trip-length record measures external travel at 25.7 to 82.6 percent
of network vehicle-miles across five development counties. Internal trip-length
changes cannot reach that term. Current `gateways.py` distributes terminating
trips by countywide job and population shares, without network impedance.
That code path supplies a specific, falsifiable structural hypothesis: gateways
send too much terminating travel across the county despite nearby opportunities.
The candidate preserves opportunities and gateway volumes, changing their joint
distribution. Diagnostic support identifies the term and the omission. It does
not establish that this particular correction will improve counts.

Use the existing OpenStreetMap networks, attributed to OpenStreetMap contributors
under [ODbL](https://www.openstreetmap.org/copyright). No paid source, new map
download, or count-derived boundary volume enters demand. Census-derived zone
attributes remain the baseline inputs. Network times are model inputs, not
measured travel behavior. The fixed inverse-time seed is an experimental
assumption, not an estimated coefficient. No parameter search follows the run.

Reject the alternatives for this experiment:

- Gateway volume seeding failed its registered study. Do not reopen it or its
  consumed partitions. Lifting the gateway cap alone multiplies guessed demand.
- LODES through travel supports commute bounds, not all-purpose through shares.
  Its annual worker flows cannot identify daily non-work vehicle demand.
- Finer zoning and distributed work loading have retained negative results.
  They also change network loading beyond this single distribution question.
- A demand or gamma scalar would compensate for residuals without identifying
  their cause. No such fit belongs in this experiment.
- Connector and restriction changes remain plausible, but they would change
  the network held fixed here and need their own development design.

The August 20 VMT bracket record supersedes the purported unexplained 1.6-fold
error as a fitting target. The August 25 uncertainty research identifies 43.3
percent APE as an old one-county selection result. Neither is a current
independent accuracy target. This experiment cannot close S1, S2, or nationwide
validation. ActivitySim remains a separate method and is not used as truth.
