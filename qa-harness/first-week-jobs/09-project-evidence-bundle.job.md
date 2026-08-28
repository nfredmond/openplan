---
id: 09-project-evidence-bundle
title: Freeze and hand off one project's evidence outside OpenPlan
account: run
files: handover
maxTurns: 240
---

You are a planner handing one active project's evidence to a colleague who must
be able to inspect it without OpenPlan.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

**What you need to have done:**

1. Start from the signed-in landing page, reach Projects through visible
   navigation, open one real project, and find its Evidence and documents area.
2. Review the complete candidate list before freezing anything. Record which
   sources are present, which records are preselected, any size or custody
   warnings, and the statement explaining what the bundle does not approve or
   publish. Do not include uploads, invoices, grant drafts, raw aerial photos,
   aerial deliverables, or model files merely to make the bundle look complete.
3. Explicitly confirm the reviewed selection and freeze the bundle. Download
   the ready ZIP and record its filename, date, byte size, manifest hash, and
   selection summary from the prior-bundles list.
4. Outside OpenPlan, open the ZIP with an available archive reader. Validate
   `checksums.sha256`, read `manifest.json`, and open the embedded GeoPackage
   with an available GIS reader. The equivalent command-line checks are
   `sha256sum -c checksums.sha256`, `jq . manifest.json`, and `ogrinfo` on the
   `.gpkg`. If this browser-only journey cannot expose the downloaded path or
   launch those local tools, say exactly which validation was not possible and
   do not claim it passed. That is a harness capability limit, not an OpenPlan
   product finding. Deterministic artifact validation is a separate required
   repository gate.

The outcome is an immutable, downloaded project evidence ZIP whose reviewed
selection and limits are visible in OpenPlan and whose contents are usable by a
recipient outside it. This discovery job reaches its visible outcome when the
reviewed bundle is ready and downloaded. The release still requires the separate
repository verifier to inspect every checksum, the manifest, and every GeoPackage
layer; this browser-only agent must never claim those checks ran when they did not.
