# Behavioral-demand production acceptance, 2026-08-18

The acceptance run started from a new account in the visible sign-up UI. The
planner created a project and model, selected a study area through the shared
place picker, launched `behavioral_demand`, and returned to the authenticated
model-detail page for the result.

## Configured execution

- Model run: `3a69499d-5e19-4995-9a9c-f8719845a59b`
- Model: `d37599f9-9660-40f9-9283-1b8f7b50c794`
- All six production stages succeeded.
- ActivitySim ran in `activitysim_cli` mode on 35,816 Census-fitted households
  and 84,566 persons.
- The vehicle-demand package contained 174,999 resident vehicle trips.
- Both assignments used the retained graph of 54,934 directed links and 24,744
  nodes. Their final relative gaps were 0.009017 and 0.009737.
- The agreement computation compared all 28,377 retained project links. JSON,
  Markdown, and GeoJSON artifacts were registered. The models were not averaged.
- An authenticated request to the run's `/agreement` route returned 28,377
  GeoJSON features with `agreement`, `first_volume`, and `second_volume` fields.

The final browser pass rendered that GeoJSON inline at 502 px wide. It showed
agree, marginal, and diverge classes. A real hover popup displayed both source
volumes, sensitivity class, and GEH. The pass recorded no console errors and no
failed HTTP responses.

## Unavailable-runtime execution

The configured poller was paused and the same production poller started with
all `ACTIVITYSIM_*` settings removed. A second new planner then launched run
`f00194cf-dee4-4465-a0f8-80d9e3fd3379` through the same visible workflow.

All six stages succeeded. Stage 4 recorded `preflight_only`; stage 5 stated that
no second network assignment existed; stage 6 stated that there were not two
demand models to compare. No demand package or agreement artifact was created.
The authenticated detail page made no failed OpenPlan request.

## Defects found by looking

The first preflight page mounted the agreement map for every succeeded
`behavioral_demand` run, including one with no agreement artifact. It requested
the authenticated agreement route and received 404. The map now requires the
`demand_model_agreement_geojson` artifact.

The first inline map sat inside the nested run-history column and measured only
163 px wide. Its popup and legend clipped the values they were meant to show.
The map now spans the run section above that nested grid, the legend wraps, and
the popup is narrower and paints above the legend.

The browser also exposed repeated React script-tag warnings on the broader model
page and one intermittent third-party Mapbox fetch failure during a preflight
pass. Neither came from the agreement route. They remain separate follow-up
work; the final configured map pass reproduced neither.

Local browser evidence is under
`qa-harness/output/2026-08-19/behavioral-demand-2026-08-19T06-18-35-616Z/` and
`qa-harness/output/2026-08-19/behavioral-demand-2026-08-19T06-33-20-150Z/`.
