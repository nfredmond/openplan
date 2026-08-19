---
name: openplan-browser
description: How to actually launch and look at OpenPlan on this machine — which browser channel works, how to confirm you are looking at the dev tree and not the walkthrough instance, which port is which project, and the local test account. Use before opening a browser against OpenPlan, or when a change is visual, geometric, or spatial.
---

# Looking at OpenPlan on this machine

Verified working as of 2026-08-13. Distilled from the `looking-at-the-app-finds-
what-tests-cannot` and `stale-openplan-on-port-3000` memories in the OpenPlan
project. If any of this stops being true, fix it here and in those memories.

## The browser

Playwright ships no chromium build for Ubuntu 26.04, so
`npx playwright install chromium` **fails**. Launch the installed Chrome instead:

```js
chromium.launch({ channel: 'chrome' })
```

The `qa-harness` scripts accept `OPENPLAN_BROWSER_CHANNEL=chrome`. Node scripts
must run from inside `qa-harness/` for `playwright` to resolve.

Browser automation uses the separate Chrome profile at
`~/.config/google-chrome-automation` over CDP. Never point automation at the live
`~/.config/google-chrome` profile.

Screenshots go in the scratchpad. On Wayland, `spectacle -b -n -o /path/out.png`
takes a desktop screenshot; X11 tools are absent and will not work.

## Which port is which — none of the running ones is your dev tree

| Port | What it actually is |
|---|---|
| 3000 | The **walkthrough instance** — a *second* clone at `~/apps/openplan`, served by the `openplan-web.service` systemd user unit. Not the tree you are editing. |
| 3100 | `~/apps/aerial-intel-platform/web` — a different project entirely. |
| 3101 | NodeODM in Docker. Looks like a Next app in a port scan only because Docker maps the container's internal 3000. |

Two Supabase stacks run side by side: OpenPlan on 54321–54324, Aerial Intel on
55321–55324. Containers named `supabase_*_openplan` are ours;
`supabase_*_Aerial_Intel_Platform` is not.

`~/code/openplan` — the dev tree — has **no always-on server**. Start one on a
free port (`ss -tln`) and confirm it is this tree with `ls -l /proc/<pid>/cwd`.

The walkthrough instance is deliberate, not a mistake: `next dev` in the canonical
checkout and `next start` on the demo box would contend for the same `.next`
directory. It exists so a persistent OpenPlan can be shown to a planner without
starting a dev server. `scripts/ops/refresh-walkthrough-instance.sh` is the
maintained way to move it forward.

**How this bit, 2026-08-08.** The instance was 174 commits behind `main`, and a
browser pass spent half an hour deducing a place-search defect that had already
been fixed in the tree being edited. The reasoning was right; the target was wrong.

Run the identity check before concluding anything from a browser:

```bash
scripts/ops/which-openplan.sh http://localhost:3000   # exits 0 on match, 1 otherwise
```

It asks `/api/health` which build is running, compares it to the checkout the
script lives in, and prints how many commits apart they are.

## Local test account

Already created and confirmed in the local stack:
`mapaudit@openplan.test` / `MapAudit!2026`, workspace `mapaudit`.

## Do not hand-seed fixtures

Seeding a row by hand makes your fixture's shape the claim rather than the
product's. A GIS layer bbox seeded as a JSON object, where the real ingest writes
a four-element `[w,s,e,n]` array, was correctly rejected by a correct parser and
the camera correctly refused to move — working code that nearly got filed as
broken. Read the real producer first.

## The four defect classes looking has actually caught

1. A page panel covering the map at 94% opacity plus an 18px blur. Layers were
   never visible under it and never could have been; 13.4% of the window was map.
2. "Show on the map" switched a layer on and never moved the camera — a 13 km
   layer inside a continental view, drawn and invisible.
3. At a wide zoom the map reported a viewport wider than the world
   (west = -185.4). The feature route rightly refused it, and every workspace
   layer silently failed to load with only a console line. Clamp the bbox before
   requesting.
4. Seventeen design-system class names referenced and defined in no stylesheet,
   including `module-grid-layout` — the only rule supplying `display: grid` to
   both RTP index pages, whose sidebars had therefore never sat beside the main
   column. Now guarded by `src/test/a-class-name-is-not-a-style.test.ts`.
