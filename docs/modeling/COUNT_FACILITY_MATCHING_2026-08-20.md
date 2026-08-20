# The eighth dropped field: a count's facility is not the road beside it

**Measured 2026-08-20.** This is a dated record of a measurement, not a promise
about what the upstream feeds will publish tomorrow.

`MODELING_AUDIT_BRIEF_2026-08-18.md` closes by asking the next session to look
for an eighth instance of one defect shape — a correction that is present,
tested, and never reached by the data it needs — and says where to look. This is
that eighth instance, found in the place the brief pointed at, and it is the
same defect as one already fixed there, wearing different clothes.

## What was wrong

A count station's description names more than one road: the one that was
counted, and the ones that say where it is. OpenPlan's non-mainline classifier
read the whole description and could not tell those apart. It also knew two
spellings for "this is not the mainline" — `ramp` and a numbered `CONN. NO. n` —
and ODOT publishes a third.

**ODOT files a frontage-road count under the parallel highway's own route
number and milepost.** The station reads as a count on the highway, the matcher
pairs it with the highway, and the comparison then grades a highway's modelled
volume against a frontage road's traffic:

| the counted facility | vehicles/day | graded against | modelled |
|---|---:|---|---:|
| Biddle Frontage Road | 450 | Crater Lake Highway | 69,385 |
| Enoch Court Frontage Rd | 284 | Sunrise Expressway | 54,351 |
| Hannon Rd. Frontage Rd. | 6,654 | Crater Lake Highway | 43,598 |
| Boones Ferry Frontage Rd | 1 | (the I-5 section it parallels) | — |

Of the 27 frontage-road stations that reached a comparison, **25 had matched a
differently-named mainline**. This is precisely the ramp defect fixed on
2026-08-17 — a real count of a real facility the screening network has no link
for, paired with the big road next to it — and the fix for it did not generalise
because the vocabulary was a list of spellings rather than a rule about which
road was counted.

The same blindness ran in the other direction. Because the classifier read the
whole description, a station was set aside whenever *any* road in its positional
clause was a ramp — including the largest count in the entire study set:

| discarded station | vehicles/day | why it was discarded |
|---|---:|---|
| Beaverton-Tigard Highway No. 144 | 95,729 | its position is "Nw of southbound Pacific Highway (I5) **ramps**" |
| Pacific Highway West No. 91 | 44,288 | "West of Beaverton-Tigard Highway (OR217SB **ramps**)" |
| Pacific Highway West No. 91 | 38,616 | "East of Beaverton-Tigard Highway (OR217NB **ramps**)" |
| Clackamas Highway No. 171 | 35,946 | "West of southbound **ramps** to Cascade Highway North" |
| Rogue Valley Highway No. 63 | 7,088 | "South of the southbound Pacific Highway (I5) **ramps**" |
| W. Elligsen Rd-Pacific Hwy | 2,980 | a connection named in its tail |

## The two conventions are opposites, which is why this is per-feed

The fix cannot be a shared rule about the word "frontage", and checking is what
established that.

- **ODOT** writes `<COUNTED FACILITY>, <where it is>`. So `US97 Frontage Rd.,
  South of Nels Anderson Place` is a frontage-road count and must be set aside,
  while `CORVALLIS-NEWPORT HIGHWAY NO. 33, West of Toledo Frontage Road` is a
  highway count and must survive.
- **WSDOT** writes `<direction> OF MILEPOST x: <what is there>`. The counted
  facility is the route; the text names a landmark. `FRONTAGE RD INTERSECTION`
  is the mainline counted *at* a frontage road, and three such WSDOT stations
  carry 20,000–37,000 vehicles a day. Applying ODOT's rule to WSDOT would
  delete them.

So each feed now declares where its counted facility is named
(`facility_clause_pattern`), alongside the spellings it already declared. A feed
that declares no convention is read whole, exactly as before. Nothing here knows
about any particular place: adding a jurisdiction is still adding a descriptor.

Caltrans and CDOT changed by nothing, and their runs are the control below.

## What was deliberately NOT excluded

An unnumbered, spelled-out `CONNECTION` stays in. `DEPOT ST. CONNECTION` matched
a link actually named Depot Street, at 6,904 observed against 26,294 modelled —
a fair comparison the model loses. Excluding it because it reads badly would be
flattering the model with its own validator. The abbreviated `CONN.` is ODOT's
interchange-connection marker and all 24 of its stations are interchange
connectors, so that one is declared.

## What it changes, including where it makes the model look worse

Both sides below were produced by **the same validator on the same runs**, with
only the station roles re-stamped — the stored summaries were graded by older
code and are not a valid baseline.

| county | matched | set aside | median APE | mean GEH |
|---|---|---|---|---|
| Clackamas OR (41005) | 144 → 138 | 73 → 110 | 103.2 → **99.7** | 29.3 → 27.8 |
| Jackson OR (41029) | 104 → 102 | 74 → 88 | 103.4 → **100.0** | 18.6 → 17.4 |
| Lincoln OR (41041) | 85 → 85 | 3 → 16 | 366.4 → **361.8** | 38.5 → **39.0** |
| Yakima WA (53077) | 46 → 46 | 101 → 101 | 75.3 → 75.3 | 19.3 → 19.3 |
| Merced CA (06047) | 75 → 75 | 0 → 0 | 77.5 → 77.5 | 23.8 → 23.8 |

**Read the small numbers, not the direction.** This moves the headline about
three points in the two counties it most affects, and the model still fails the
30% gate by more than a factor of three. It is a measurement-quality fix, and
anyone reading it as progress on accuracy has read it wrong. In Lincoln County
the mean GEH got slightly *worse*, which is what an honest re-grading looks like.

The two counties whose feeds declare no new rule did not move at all. That is
the control, and it is the reason to believe the rest.

**It restores bad news as well as removing it.** Clackamas Highway No. 171,
recovered from the discard pile, grades 35,946 observed against 1,518 modelled —
a 96% under-assignment on a real highway that nobody could see while the station
was being thrown away. Two further stations moved from `excluded_ambiguous_link`
to `matched`, because the frontage siblings that made their link ambiguous are
no longer competing for it.

## Consequence for stored figures

`VALIDATION_RULES_VERSION` is now **3**. Every accuracy figure stored before
today was graded by rules that compared frontage-road counts against mainlines
and discarded highway counts for their neighbours, so it reports a different
quantity under the same name. The app says so on any run stamped below 3.

That stamp was itself a copy of one number kept by hand in two languages, with a
silent failure in both directions — the very defect shape this document is about.
It now has a guard:
`openplan/src/test/validation-rules-version-matches-the-worker.test.ts`.

## Still open, found while measuring and not fixed

1. **57 of 1,011 matched stations (5.6%) have a modelled volume of exactly
   zero**, and the median observed volume at those stations is 4,700 — 28 of
   them exceed 5,000, one reaches 156,346. Zero is not "a little traffic"; it
   means no path used the link. **46% of tertiary-class stations are in this
   group**, which is most of what the 0.07× tertiary signature actually is. It
   is not known whether those links are disconnected in the routable network,
   are the wrong link for the station, or are genuinely unused. Nobody has
   looked, and it is the first thing to look at next.
2. The trunk class has a median volume ratio of 2.65 and a **mean of 239**. The
   median is robust and the published over-assignment figures use it, so they
   stand — but any metric in this lane that uses a mean is being set by a
   handful of stations, and should be checked before it is believed.
