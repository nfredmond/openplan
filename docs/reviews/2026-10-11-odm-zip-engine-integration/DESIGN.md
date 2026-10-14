# Bind original ZIP image slots before engine commands

This isolated M3 candidate connects actual retained ZIP custody to the original
private engine command journal. It sends no HTTP requests. The main merge hold
remains in effect until the coordinator records a dated lift after the technical
handoff, separate Opus review and resolution of release blockers.

## Preserve original source and command identity

Photo plans keep `openplan.odm-engine-plan.v1` and their existing eight fields.
ZIP plans use `openplan.odm-engine-zip-plan.v1`. Their added `sourceCustody`
records the retained source manifest hash, raw archive size and hash, and original
derived-image plan hash. The source manifest hash binds the complete derived
manifest. Upload records keep original member paths, deterministic image names,
private image object paths, ordered slots, actual sizes and hashes.

`Effects` accepts explicit derivation arguments. Its constructor and each
journal operation run the actual retained ZIP derivation verifier. Raw ZIP bytes
cannot become an image upload. Changed source, derived bytes, original context,
limits or journal identity refuse publication. Engine journal roots cannot
overlap raw or derived source roots. Caller argument changes do not change the
saved plan.

Existing once-only intent and exact reply rules apply to ZIP image commands.
An uncertain intent keeps its original descriptor and does not issue again.
Complete retained source custody permits relocation without the original source
URL or input file. Missing derived slots recover from the original retained ZIP.

## Compare captured drafts without transport permission

The draft inspector reconstructs either original plan format. ZIP lineage,
image paths and member ordering remain typed and explicit. Actual captured
metadata and image bytes must match the original engine plan. Byte agreement
does not attest engine ownership, source authority, image decoding, processing
readiness or permission to repeat an external effect.

## Check the bounded claim

Use focused tests, harmless source edits and targeted broken behaviors. Preserve
failed trials and restore source edits in `finally`. Rerun the historical engine
and draft controls against the current code. Exercise a real child interruption,
stopped-root capture, verified package and fresh-copy journal replay. Keep
ordinary source/package bytes and full SQLite schema/rows unchanged.

This candidate does not connect `main.py`, intake transport or the HTTP engine
client. It does not establish live authority, worker end-to-end recovery, commit
reconciliation, callbacks, browser acceptance, image decoding or reconstruction.
Private cooperative writers and filesystem durability remain assumptions.
