# Correction to the v0.27.0 land-use-plan release note

**Dated 2026-08-23.** The v0.27.0 changelog said the Land Use Plans module
carried a plan from authoring through annual reporting. That was too broad.

What v0.27.0 actually established was the plan registry, descriptor-backed
content, working and frozen versions, mapped-designation references, private
consultation records, adoption records, and implementation-report records.
Several user-facing seams were still missing:

- a frozen public release that an anonymous reader could open;
- a frozen comment-disposition outcome tied to that exact release;
- a revision kind between a reviewed draft and an adopted amendment;
- an adoption manifest binding the reviewed hash, outcome, hearing evidence,
  decision, and supporting documents;
- public maps restricted to planner-selected attributes from an immutable GIS
  version; and
- readable plan-packet and implementation-report pages linked from the
  workbench and named for the plan rather than an unknown project.

Those gaps meant v0.27.0 could store pieces of the workflow but could not
complete the public-review and reporting path it described. v0.28.0 adds that
path. This correction supplements the dated v0.27.0 entry; it does not rewrite
what that release claimed when it shipped.
