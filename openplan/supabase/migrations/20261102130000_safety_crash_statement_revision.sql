-- KI-2026-11-02-020: a crash acquisition above about 100 crashes could not be stored.
-- Each safety_crashes or safety_crash_parties row bumped its acquisition's
-- evidence_revision, and each crash row also touched its project. One 500-row
-- write therefore updated the project row about 1,000 times and fired every
-- project row trigger each time. On a project with a large study-area polygon
-- that passed the 8-second statement timeout.
--
-- The row fence keeps every lock and refusal where 20261023190100 put them:
-- before the row is written, projects then acquisitions, sorted, FOR UPDATE
-- NOWAIT, then the captured-acquisition and parent checks, with the same
-- messages and SQLSTATEs. Only the writes move to statement triggers over
-- transition tables: one evidence_revision increment per acquisition per
-- statement, and one project touch per project per statement. evidence_revision
-- is a change token that readers compare for equality; nothing reads it as a
-- row count. The acquisition table's own triggers are unchanged.
--
-- The helpers live in public because safety_comparison_private's function
-- inventory is pinned. They are trigger functions and run only as triggers.
-- Rollback recreates the row triggers from 20261023190100 and 20260827000003.

CREATE OR REPLACE FUNCTION public.safety_crash_child_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_id uuid; new_id uuid; a uuid; p uuid; parent public.safety_crash_ingests%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN old_id := OLD.ingest_id; END IF;
 IF TG_OP <> 'DELETE' THEN new_id := NEW.ingest_id; END IF;
 -- Both parents, sorted, including reassignment to a different acquisition.
 FOR p IN SELECT DISTINCT project_id FROM public.safety_crash_ingests
   WHERE id IN(old_id,new_id) AND project_id IS NOT NULL ORDER BY project_id LOOP
  PERFORM 1 FROM public.projects WHERE id=p FOR UPDATE NOWAIT;
 END LOOP;
 FOR a IN SELECT DISTINCT x FROM unnest(ARRAY[old_id,new_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT * INTO parent FROM public.safety_crash_ingests WHERE id=a FOR UPDATE NOWAIT;
  IF EXISTS(SELECT FROM public.report_safety_comparison_revisions WHERE acquisition_id=a) THEN
   RAISE EXCEPTION 'Captured acquisition is immutable. Retain it and acquire a new source.' USING ERRCODE='23514';
  END IF;
  IF TG_OP <> 'DELETE' AND a=new_id AND (NOT FOUND OR parent.workspace_id IS DISTINCT FROM NEW.workspace_id OR parent.source_id IS DISTINCT FROM NEW.source_id) THEN
   RAISE EXCEPTION 'Observation source parent differs' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;

-- One increment per acquisition per statement. The acquisition's own fence
-- re-locks and rechecks it and sets the stored value to OLD + 1.
CREATE OR REPLACE FUNCTION public.safety_crash_child_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; a uuid;
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT ingest_id ORDER BY ingest_id) INTO ids FROM new_rows;
 ELSIF TG_OP='UPDATE' THEN SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM (
   SELECT ingest_id x FROM old_rows UNION ALL SELECT ingest_id FROM new_rows) q;
 ELSE SELECT array_agg(DISTINCT ingest_id ORDER BY ingest_id) INTO ids FROM old_rows;
 END IF;
 FOR a IN SELECT x FROM unnest(ids) x ORDER BY x LOOP
  UPDATE public.safety_crash_ingests SET evidence_revision=evidence_revision+1 WHERE id=a;
 END LOOP;
 RETURN NULL;
END;
$$;

-- One project touch per project per statement, for crash rows only, as the
-- row-level bump_project_revision_from_parent_evidence('ingest_id', ...) did.
CREATE OR REPLACE FUNCTION public.bump_project_revision_from_safety_crash_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; p uuid;
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT ingest_id) INTO ids FROM new_rows;
 ELSIF TG_OP='UPDATE' THEN SELECT array_agg(DISTINCT x) INTO ids FROM (
   SELECT ingest_id x FROM old_rows UNION ALL SELECT ingest_id FROM new_rows) q;
 ELSE SELECT array_agg(DISTINCT ingest_id) INTO ids FROM old_rows;
 END IF;
 FOR p IN SELECT DISTINCT project_id FROM public.safety_crash_ingests
   WHERE id = ANY(ids) AND project_id IS NOT NULL ORDER BY project_id LOOP
  PERFORM public.touch_project_evidence_revision(p);
 END LOOP;
 RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.safety_crash_child_fence() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.safety_crash_child_revision() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bump_project_revision_from_safety_crash_rows() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS safety_comparison_crash_fence ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_party_fence ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_insert ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_update ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_crash_revision_delete ON public.safety_crashes;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_insert ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_update ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS safety_comparison_party_revision_delete ON public.safety_crash_parties;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_insert ON public.safety_crashes;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_update ON public.safety_crashes;
DROP TRIGGER IF EXISTS trg_safety_crashes_project_evidence_revision_delete ON public.safety_crashes;

CREATE TRIGGER safety_comparison_crash_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crashes
 FOR EACH ROW EXECUTE FUNCTION public.safety_crash_child_fence();
CREATE TRIGGER safety_comparison_party_fence BEFORE INSERT OR UPDATE OR DELETE ON public.safety_crash_parties
 FOR EACH ROW EXECUTE FUNCTION public.safety_crash_child_fence();

-- A trigger with transition tables may name only one event. AFTER STATEMENT
-- triggers fire by name, so the revision bump runs before the project touch,
-- the order the BEFORE and AFTER row triggers had.
CREATE TRIGGER safety_comparison_crash_revision_insert AFTER INSERT ON public.safety_crashes
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER safety_comparison_crash_revision_update AFTER UPDATE ON public.safety_crashes
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER safety_comparison_crash_revision_delete AFTER DELETE ON public.safety_crashes
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER safety_comparison_party_revision_insert AFTER INSERT ON public.safety_crash_parties
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER safety_comparison_party_revision_update AFTER UPDATE ON public.safety_crash_parties
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER safety_comparison_party_revision_delete AFTER DELETE ON public.safety_crash_parties
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.safety_crash_child_revision();
CREATE TRIGGER trg_safety_crashes_project_evidence_revision_insert AFTER INSERT ON public.safety_crashes
 REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_project_revision_from_safety_crash_rows();
CREATE TRIGGER trg_safety_crashes_project_evidence_revision_update AFTER UPDATE ON public.safety_crashes
 REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_project_revision_from_safety_crash_rows();
CREATE TRIGGER trg_safety_crashes_project_evidence_revision_delete AFTER DELETE ON public.safety_crashes
 REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.bump_project_revision_from_safety_crash_rows();
