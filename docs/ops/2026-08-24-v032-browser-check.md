# v0.32 browser check — 2026-08-24

Candidate source: `92fb82e0` from `/home/nathaniel/code/openplan/openplan`,
served locally on port 3012 against the local Supabase stack. The development
version endpoint correctly reported the checkout as unrecorded rather than
inventing a commit identity.

The pass exercised the real signed-in planner surfaces in two existing test
workspaces:

- Nevada County, California (`mapaudit`), with existing CCRS evidence and a
  newly completed corridor analysis.
- Franklin County, Ohio, representing a workspace outside the configured
  California crash-source coverage.

Each affected journey was inspected at desktop width and at 390 by 844 pixels:
the deployment overview, My Work, Models, Safety, and Corridor Analysis. The
mobile layouts stayed within the viewport.

Observed behavior:

- Both deployment and Models surfaces named worker capability as unknown when
  no compatible heartbeat row was available. Behavioral-demand copy required
  both AequilibraE and ActivitySim rather than treating one worker as enough.
- My Work showed the missing scheduler-health warning even with existing
  reminders. Owners/admins could see the seven-day, email-enabled default;
  in-app reminders had no disable control.
- California Safety named the existing source but stated that it supplied no
  exact publication cutoff. Ohio Safety stated that no configured source
  answered rather than presenting zero crashes.
- A corridor run completed through the planner UI. Accessibility was shown as
  “Not measured” because transit evidence was unavailable, the composite was
  withheld, and independently supported Safety and Equity evidence remained
  visible. No low/medium/high band appeared. The crash lane repeated that
  requested and returned years are not an exact publication cutoff.

The browser pass found two defects before release. Deployment copy still said a
new deployment used a “poller with no heartbeat,” contradicting the new durable
heartbeat contract. Corridor evidence carried the missing cutoff internally but
did not say so on the result surface. Both were corrected in `91c669d7` and
`92fb82e0`, then protected by deliberate failure mutations recorded in
`V032_OPERATIONAL_HEALTH_PROOF_2026-08-24.md`.
