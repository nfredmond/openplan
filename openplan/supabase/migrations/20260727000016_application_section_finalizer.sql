-- Finalizer provenance on application sections.
--
-- funding_opportunity_application_sections.updated_by / updated_at are
-- TOUCH-LATEST columns: any later edit overwrites them, and the application
-- reorder PATCH stamps them on EVERY row of the opportunity. Finalization is
-- an EVENT — who committed the section's approved text, and when. The export
-- provenance appendix used to derive "Finalized by" from updated_by, so a
-- stored PDF could name whoever last reordered the packet instead of the
-- operator who actually approved the text. These two columns record the event
-- itself: the finalize route stamps them when final text is committed and
-- clears them when a final section is reopened, and no other touch may write
-- them.
--
-- Deliberately NO backfill: for rows finalized before this migration,
-- updated_by is exactly the value that cannot be trusted as the finalizer, so
-- existing final rows keep NULL and the export discloses
-- "finalized before finalizer tracking; not recorded" instead of guessing.

ALTER TABLE funding_opportunity_application_sections
  ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE funding_opportunity_application_sections
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

COMMENT ON COLUMN funding_opportunity_application_sections.finalized_by IS
  'Who committed the section''s CURRENT final_markdown — the finalization event. Unlike updated_by (touch-latest, overwritten by reorders and later edits), only the finalize route writes this; it is cleared when a final section is reopened. NULL for rows finalized before finalizer tracking existed.';
COMMENT ON COLUMN funding_opportunity_application_sections.finalized_at IS
  'When the section''s CURRENT final_markdown was committed. Written and cleared together with finalized_by; NULL for rows finalized before finalizer tracking existed.';
