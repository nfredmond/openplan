# v0.31 planner-surface browser check

Checked on 2026-08-24 against the development checkout serving OpenPlan 0.31.0.
The server process working directory was
`/home/nathaniel/code/openplan/openplan`; `scripts/ops/which-openplan.sh`
confirmed that the browser was not pointed at the walkthrough instance.

## Journeys

- In the Nevada County, California workspace, the Corridor Analysis entry
  prefilled Nevada County and framed the county boundary on the map.
- In the Franklin County, Ohio workspace, the same entry prefilled Franklin
  County. Crash data rendered as `No data` with an explicit empty-record and
  coverage caveat; it did not render missing coverage as zero.
- A county-run detail page with no claimed attempt hid the worker handoff. The
  presenter test verifies that a stored attempt displays its exact
  `data/screening-runs/<countyRunId>/<jobId>/...` path.

The browser console had no application errors. It did show the existing Next.js
`metadataBase` development warning.

## Defect found and closed before release

A prepared but not-enqueued county run displayed the durable setup stage as
`Running` and polled the detail endpoint every five seconds. The page now labels
that stage `Setup Incomplete`, shows live worker state separately, and polls
only while the attempt is queued, running, or cancelling. Both behaviors are
mutation-proved in the v0.31 integrity record.

The same page also synthesized a random worker job id and called it a stored
handoff before any attempt existed. Attempt identity is now read only from the
stored payload; preparing the handoff is what creates it.
