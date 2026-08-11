/**
 * How the project control room orders the things that have a date on them.
 *
 * THE LOGIC MOVED (2026-08-11) to `src/lib/work/deadlines.ts` and this module is
 * now a re-export. It was extracted because a third caller arrived — the
 * personal work queue at `/my-work`, which merges dated records across projects
 * — and the same shaping already existed twice (here and in
 * `src/lib/projects/controls.ts`). Two copies is a divergence waiting to happen;
 * three is one that has happened. Nothing about the behaviour changed in the
 * move, and this file keeps its name and its exports so no call site had to move
 * at the same time as the logic.
 *
 * A page's `_components` directory cannot be imported from `src/lib`, which is
 * the mechanical reason the shared home is under `lib/work/` rather than here.
 *
 * NOTE FOR WHOEVER CONSOLIDATES FURTHER. `latestKnownDate` and `latestDate` in
 * `src/lib/projects/spine-readiness.ts` do the same job. They are still NOT
 * merged: the two differ in what they do with an unparseable value, and the
 * spine rollup's behaviour is asserted by its own tests, so unifying them is a
 * change with its own evidence rather than a rename.
 */

export {
  compareDateValues,
  invoicePriority,
  latestKnownDate,
  milestonePriority,
  parseSortableDate,
  submittalPriority,
} from "@/lib/work/deadlines";
