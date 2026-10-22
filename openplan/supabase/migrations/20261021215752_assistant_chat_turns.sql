-- SOURCE ONLY. CLI-allocated stub 20261021215752. No admission is seeded.
-- New chat custody never broadens project packet v1, op_pc_ or old receipts.
BEGIN;
CREATE SCHEMA assistant_chat_private;
REVOKE ALL ON SCHEMA assistant_chat_private FROM PUBLIC,anon,authenticated,service_role;
CREATE ROLE openplan_chat_authorizer NOLOGIN NOINHERIT NOBYPASSRLS;
-- The installer resolves platform identity inside actor(); source reads stay below.
GRANT USAGE ON SCHEMA public,extensions,assistant_chat_private TO openplan_chat_authorizer;
-- No membership in authenticated/service_role, domain ownership or domain DML.
GRANT SELECT(id,name) ON public.workspaces TO openplan_chat_authorizer;
GRANT SELECT(workspace_id,user_id,role) ON public.workspace_members TO openplan_chat_authorizer;
GRANT SELECT(id,workspace_id,name,summary,status,plan_type,delivery_phase,updated_at) ON public.projects TO openplan_chat_authorizer;
GRANT SELECT ON public.workspace_provider_api_connections,public.workspace_provider_api_revisions TO openplan_chat_authorizer;
GRANT SELECT,INSERT ON public.usage_events TO openplan_chat_authorizer;
GRANT SELECT,INSERT ON public.assistant_action_approvals TO openplan_chat_authorizer;
GRANT SELECT ON public.assistant_action_executions TO openplan_chat_authorizer;

-- Clone applicable SELECT qualifications, including restrictive policies, onto
-- the non-inheriting role. Fingerprint drift closes admission at every release.
-- This avoids inheriting authenticated's domain-write privileges merely to get
-- its RLS policies. Effective grants and policy equivalence remain native gates.
CREATE TABLE assistant_chat_private.source_policy_pins(table_oid oid PRIMARY KEY, fingerprint text NOT NULL);
CREATE FUNCTION assistant_chat_private.policy_fingerprint(p_table oid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,extensions AS $$
 SELECT encode(extensions.digest(convert_to(coalesce(string_agg(p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),''),'|' ORDER BY p.polname),''),'UTF8'),'sha256'),'hex')
 FROM pg_policy p WHERE p.polrelid=p_table
$$;
DO $body$
DECLARE t regclass; p record; n int:=0;
BEGIN
 FOREACH t IN ARRAY ARRAY['public.workspaces'::regclass,'public.workspace_members'::regclass,'public.projects'::regclass,
  'public.workspace_provider_api_connections'::regclass,'public.workspace_provider_api_revisions'::regclass,
  'public.usage_events'::regclass,'public.assistant_action_approvals'::regclass,'public.assistant_action_executions'::regclass] LOOP
  INSERT INTO assistant_chat_private.source_policy_pins VALUES(t,assistant_chat_private.policy_fingerprint(t));
  FOR p IN SELECT * FROM pg_policy WHERE polrelid=t AND polcmd IN ('r','*')
    AND (0=ANY(polroles) OR 'authenticated'::regrole::oid=ANY(polroles)) LOOP
   n:=n+1;
   EXECUTE format('CREATE POLICY %I ON %s AS %s FOR SELECT TO openplan_chat_authorizer USING (%s)',
    'assistant_chat_source_'||n,t,CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,coalesce(pg_get_expr(p.polqual,t),'true'));
  END LOOP;
 END LOOP;
END $body$;
-- These are custody capabilities only. Existing approval and usage policies
-- may not admit writes by the new role; narrow policies do not grant source DML.
CREATE POLICY assistant_chat_approval_insert ON public.assistant_action_approvals FOR INSERT TO openplan_chat_authorizer
 WITH CHECK(user_id=auth.uid() AND action_kind='create_project_record');
CREATE POLICY assistant_chat_usage_insert ON public.usage_events FOR INSERT TO openplan_chat_authorizer
 WITH CHECK(bucket_key='assistant_chat' AND source_route='/api/assistant/providers/chat');
CREATE POLICY assistant_chat_usage_read ON public.usage_events FOR SELECT TO openplan_chat_authorizer
 USING(EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=usage_events.workspace_id AND m.user_id=auth.uid()));
CREATE POLICY assistant_chat_approval_read ON public.assistant_action_approvals FOR SELECT TO openplan_chat_authorizer
 USING(user_id=auth.uid() AND action_kind='create_project_record' AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=assistant_action_approvals.workspace_id AND m.user_id=auth.uid()));
CREATE POLICY assistant_chat_execution_read ON public.assistant_action_executions FOR SELECT TO openplan_chat_authorizer
 USING(user_id=auth.uid() AND action_kind='create_project_record' AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=assistant_action_executions.workspace_id AND m.user_id=auth.uid()));
-- Record the newly added non-source policies too, so later policy drift refuses.
UPDATE assistant_chat_private.source_policy_pins SET fingerprint=assistant_chat_private.policy_fingerprint(table_oid);

CREATE TABLE public.assistant_chat_admissions(
 id uuid PRIMARY KEY, record_canonical text NOT NULL CHECK(octet_length(record_canonical)<=100000), record_hash text NOT NULL,
 admitted boolean NOT NULL DEFAULT false, revoked_at timestamptz,
 CHECK(record_hash=encode(extensions.digest(convert_to(record_canonical,'UTF8'),'sha256'),'hex')));
COMMENT ON TABLE public.assistant_chat_admissions IS 'Operator-reviewed exact endpoint/model/revision/profile/projection/catalog and worker-pool evidence. Empty by default. Not an entitlement.';
CREATE TABLE public.assistant_chat_grants(
 id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES auth.users(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 prepare_request_id uuid NOT NULL, acceptance_request_id uuid NOT NULL, turn_request_id uuid NOT NULL,
 canonical text NOT NULL CHECK(octet_length(canonical)<=240000), digest text NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','accepted','revoked')),
 accept_before timestamptz NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
 UNIQUE(owner_user_id,prepare_request_id), UNIQUE(owner_user_id,acceptance_request_id), UNIQUE(owner_user_id,turn_request_id),
 CHECK(digest=encode(extensions.digest(convert_to(E'OpenPlan.AssistantChatGrant.v1\n'||canonical,'UTF8'),'sha256'),'hex')));
CREATE TABLE public.assistant_chat_turns(
 id uuid PRIMARY KEY, grant_id uuid NOT NULL UNIQUE REFERENCES public.assistant_chat_grants(id), owner_user_id uuid NOT NULL REFERENCES auth.users(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), attempt_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','accepted','running','succeeded','unsupported','unavailable','failed','unassessed','interrupted','uncertain','cancelled','access_lost')),
 revision bigint NOT NULL DEFAULT 0, cursor bigint NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 model_steps int NOT NULL DEFAULT 0 CHECK(model_steps BETWEEN 0 AND 6), response_bytes int NOT NULL DEFAULT 0 CHECK(response_bytes BETWEEN 0 AND 3072000),
 reported_output_tokens int NOT NULL DEFAULT 0 CHECK(reported_output_tokens BETWEEN 0 AND 12000), usage_unknown boolean NOT NULL DEFAULT false,
 tool_bytes int NOT NULL DEFAULT 0 CHECK(tool_bytes BETWEEN 0 AND 768000), failure_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX assistant_chat_owner_history ON public.assistant_chat_turns(owner_user_id,workspace_id,created_at DESC,id);
CREATE TABLE public.assistant_chat_sources(
 id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id), envelope jsonb NOT NULL,
 content_hash text NOT NULL, UNIQUE(turn_id,id));
CREATE TABLE public.assistant_chat_steps(
 id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id), sequence int NOT NULL CHECK(sequence BETWEEN 1 AND 6),
 request_canonical text NOT NULL CHECK(octet_length(request_canonical)<=256000), request_hash text NOT NULL,
 transcript_hash text NOT NULL, dependency_hash text NOT NULL, state text NOT NULL CHECK(state IN ('dispatched','completed','uncertain','failed')),
 receipt jsonb, receipt_hash text, UNIQUE(turn_id,sequence));
CREATE TABLE public.assistant_chat_tool_calls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id), step_id uuid NOT NULL REFERENCES public.assistant_chat_steps(id),
 call_id text NOT NULL CHECK(call_id ~ '^[A-Za-z0-9_-]{1,200}$'), name text NOT NULL CHECK(name IN ('list_projects','get_surface_context','propose_create_project_record')),
 input jsonb NOT NULL,input_hash text NOT NULL, state text NOT NULL CHECK(state IN ('reserved','running','completed','failed','uncertain')),
 handle uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), result jsonb, result_hash text, UNIQUE(turn_id,call_id));
CREATE TABLE public.assistant_chat_events(
 turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id), sequence bigint NOT NULL, kind text NOT NULL,
 body jsonb NOT NULL, body_hash text NOT NULL, previous_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(turn_id,sequence));
CREATE TABLE public.assistant_chat_access_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL, workspace_id uuid NOT NULL, turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id),
 attempt_id uuid NOT NULL, grant_digest text NOT NULL, purpose text NOT NULL, exact_body_hash text NOT NULL, dependency_set_hash text NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp(), result text NOT NULL, failed_anchor_ids jsonb NOT NULL DEFAULT '[]', failure_code text);
CREATE UNIQUE INDEX assistant_chat_frame_identity ON public.assistant_chat_events(turn_id,(body->>'stepId'),(body->>'frameSequence')) WHERE kind='text_delta';
CREATE TABLE public.assistant_chat_proposal_intents(
 id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES auth.users(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 turn_id uuid NOT NULL REFERENCES public.assistant_chat_turns(id), attempt_id uuid NOT NULL, grant_id uuid NOT NULL REFERENCES public.assistant_chat_grants(id), grant_digest text NOT NULL,
 step_id uuid NOT NULL REFERENCES public.assistant_chat_steps(id), tool_call_id text NOT NULL, proposal_ordinal int NOT NULL DEFAULT 0 CHECK(proposal_ordinal=0), event_sequence bigint NOT NULL,
 executable_canonical text NOT NULL, executable_hash text NOT NULL, dependency_hash text NOT NULL, display_consequence_hash text NOT NULL,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approval_creating','approved','execution_requested','reconciling','succeeded','refused','expired','withdrawn')),
 approval_request_id uuid, original_approval_id uuid UNIQUE REFERENCES public.assistant_action_approvals(id), approval_expires_at timestamptz, approved_by_user_id uuid,
 execution_state text NOT NULL DEFAULT 'not_requested' CHECK(execution_state IN ('not_requested','requested','uncertain','committed','refused')),
 receipt_state text NOT NULL DEFAULT 'not_checked' CHECK(receipt_state IN ('not_checked','absent_confirmed','present_verified','unavailable','conflict')),
 receipt_identity jsonb, revision bigint NOT NULL DEFAULT 0, recovery_href text NOT NULL,
 repeat_of_intent_id uuid REFERENCES public.assistant_chat_proposal_intents(id), repeat_request_id uuid,
 UNIQUE(attempt_id,step_id,tool_call_id,proposal_ordinal), UNIQUE(owner_user_id,repeat_request_id),
 CHECK(executable_hash=encode(extensions.digest(convert_to(executable_canonical,'UTF8'),'sha256'),'hex')));
DO $body$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_chat_admissions','assistant_chat_grants','assistant_chat_turns','assistant_chat_sources','assistant_chat_steps','assistant_chat_tool_calls','assistant_chat_events','assistant_chat_access_checks','assistant_chat_proposal_intents'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO openplan_chat_authorizer',t);
  EXECUTE format('CREATE POLICY custody ON public.%I FOR ALL TO openplan_chat_authorizer USING(true) WITH CHECK(true)',t);
 END LOOP;
END $body$;
-- No direct body SELECT, including for the owner. Minimal metadata is an RPC.
GRANT SELECT,INSERT,UPDATE ON public.assistant_chat_admissions TO service_role;
CREATE POLICY operator_admission ON public.assistant_chat_admissions FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT SELECT ON assistant_chat_private.source_policy_pins TO openplan_chat_authorizer;

-- Lossless storage nodes are private, never a new accepted JSON object shape.
-- PostgreSQL text/jsonb cannot contain NUL. A JSON string with NUL is retained
-- as an ordered array of NUL-free segments; each boundary means one U+0000.
-- The reserved key cannot occur in this profile's closed object schemas.
-- Literal occurrences inside strings remain ordinary strings, without escaping
-- or normalization. Original canonical consent/request/raw-provider bytes stay
-- text. Public wrappers transport canonical logical JSON inside a versioned
-- string envelope. Application callers decode it after PostgREST serialization.
CREATE FUNCTION assistant_chat_private.no_duplicate_keys(v json) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item json;
BEGIN
 IF json_typeof(v)='object' THEN
  IF (SELECT count(*)<>count(DISTINCT key) FROM json_each(v)) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM json_each(v) LOOP IF NOT assistant_chat_private.no_duplicate_keys(item) THEN RETURN false; END IF; END LOOP;
 ELSIF json_typeof(v)='array' THEN
  FOR item IN SELECT value FROM json_array_elements(v) LOOP IF NOT assistant_chat_private.no_duplicate_keys(item) THEN RETURN false; END IF; END LOOP;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION assistant_chat_private.lossless(v json) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE raw text:=v::text; matched text[]; token text; decoded jsonb; parts jsonb; chunks text[]:='{}';
 bytes bytea; n int; start int; size int; key text;
BEGIN
 -- The json input has already passed JSON syntax validation. Native matching
 -- copies whole ordinary runs and complete escape pairs, so escaped quotes or
 -- backslashes cannot become string boundaries. Decode every string separately
 -- before jsonb can discard duplicate keys or encounter a logical NUL.
 FOR matched IN SELECT regexp_matches(raw,$re$("(?:[^"\\]|\\.)*")([ \t\r\n]*:)?|([^"]+)$re$,'g') LOOP
  IF matched[1] IS NULL THEN chunks:=array_append(chunks,matched[3]); CONTINUE; END IF;
  token:=matched[1]; parts:='[]';
  IF strpos(token,E'\\u0000')>0 THEN
   -- Only this exceptional token needs a byte scan. Offsets address UTF-8
   -- bytes, and slices end at ASCII escape boundaries, never inside a scalar.
   bytes:=convert_to(token,'UTF8'); size:=octet_length(bytes); n:=2; start:=2;
   WHILE n<size LOOP
    IF get_byte(bytes,n-1)=92 THEN
     IF substring(bytes FROM n FOR 6)=convert_to(E'\\u0000','UTF8') THEN
      parts:=parts||jsonb_build_array(('"'||convert_from(substring(bytes FROM start FOR n-start),'UTF8')||'"')::jsonb);
      n:=n+6; start:=n; CONTINUE;
     END IF;
     n:=n+2;
    ELSE n:=n+1; END IF;
   END LOOP;
   IF jsonb_array_length(parts)>0 THEN
    parts:=parts||jsonb_build_array(('"'||convert_from(substring(bytes FROM start FOR size-start),'UTF8')||'"')::jsonb);
   END IF;
  END IF;
  IF jsonb_array_length(parts)>0 THEN
   IF matched[2] IS NOT NULL THEN RAISE EXCEPTION 'Invalid chat object key' USING ERRCODE='22023'; END IF;
   chunks:=array_append(chunks,jsonb_build_object('$openplan_chat_nul_v1',parts)::text);
  ELSE
   -- This also validates untouched escapes and rejects lone surrogates.
   decoded:=token::jsonb;
   IF matched[2] IS NOT NULL THEN
    key:=decoded#>>'{}';
    IF key='$openplan_chat_nul_v1' THEN RAISE EXCEPTION 'Reserved chat object key' USING ERRCODE='22023'; END IF;
   END IF;
   chunks:=array_append(chunks,token);
  END IF;
  chunks:=array_append(chunks,coalesce(matched[2],''));
 END LOOP;
 raw:=array_to_string(chunks,'');
 IF NOT assistant_chat_private.no_duplicate_keys(raw::json) THEN RAISE EXCEPTION 'Duplicate chat object key' USING ERRCODE='22023'; END IF;
 RETURN raw::jsonb;
END $$;
CREATE FUNCTION assistant_chat_private.string_parts(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(v)='string' THEN RETURN jsonb_build_array(v); END IF;
 IF jsonb_typeof(v)='object' AND (SELECT count(*) FROM jsonb_object_keys(v))=1 AND v ? '$openplan_chat_nul_v1'
  AND jsonb_typeof(v->'$openplan_chat_nul_v1')='array' AND jsonb_array_length(v->'$openplan_chat_nul_v1')>=2
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'$openplan_chat_nul_v1') x WHERE jsonb_typeof(x)<>'string') THEN RETURN v->'$openplan_chat_nul_v1'; END IF;
 RAISE EXCEPTION 'Expected lossless chat string' USING ERRCODE='22023';
END $$;
CREATE FUNCTION assistant_chat_private.is_string(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN PERFORM assistant_chat_private.string_parts(v); RETURN true; EXCEPTION WHEN others THEN RETURN false; END $$;
CREATE FUNCTION assistant_chat_private.string_node(parts jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_array_length(parts)=1 THEN parts->0 ELSE jsonb_build_object('$openplan_chat_nul_v1',parts) END
$$;
CREATE FUNCTION assistant_chat_private.string_concat(a jsonb,b jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE x jsonb:=assistant_chat_private.string_parts(a); y jsonb:=assistant_chat_private.string_parts(b); last int:=jsonb_array_length(x)-1;
BEGIN
 x:=jsonb_set(x,ARRAY[last::text],to_jsonb((x->>last)||(y->>0)));
 RETURN assistant_chat_private.string_node(x||(y-0));
END $$;
-- ECMAScript TrimString whitespace and line terminators, explicitly enumerated.
-- NUL is not whitespace. Trimming stops at its first/last segment boundary.
CREATE FUNCTION assistant_chat_private.trim_string(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE parts jsonb:=assistant_chat_private.string_parts(v); last int:=jsonb_array_length(parts)-1;
 chars text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 parts:=jsonb_set(parts,'{0}',to_jsonb(ltrim(parts->>0,chars)));
 parts:=jsonb_set(parts,ARRAY[last::text],to_jsonb(rtrim(parts->>last,chars)));
 RETURN assistant_chat_private.string_node(parts);
END $$;
-- JS/Zod length counts UTF-16 code units; PostgreSQL length counts scalars.
CREATE FUNCTION assistant_chat_private.string_length(v jsonb) RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE parts jsonb:=assistant_chat_private.string_parts(v); s text; n int; total int:=jsonb_array_length(parts)-1;
BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements_text(parts) LOOP
  FOR n IN 1..length(s) LOOP total:=total+CASE WHEN ascii(substr(s,n,1))>65535 THEN 2 ELSE 1 END; END LOOP;
 END LOOP; RETURN total;
END $$;
CREATE FUNCTION assistant_chat_private.string_bytes(v jsonb) RETURNS int LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_array_length(assistant_chat_private.string_parts(v))-1+coalesce(sum(octet_length(value)),0)::int FROM jsonb_array_elements_text(assistant_chat_private.string_parts(v))
$$;

CREATE FUNCTION assistant_chat_private.string_hash(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,extensions AS $$
DECLARE parts jsonb:=assistant_chat_private.string_parts(v); raw bytea:=''::bytea; s text; first boolean:=true;
BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements_text(parts) LOOP
  IF NOT first THEN raw:=raw||decode('00','hex'); END IF;
  raw:=raw||convert_to(s,'UTF8'); first:=false;
 END LOOP; RETURN encode(extensions.digest(raw,'sha256'),'hex');
END $$;

CREATE FUNCTION assistant_chat_private.canonical(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE parts jsonb; result text:='';
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'null' THEN RETURN 'null'; WHEN 'boolean' THEN RETURN v::text;
 WHEN 'number' THEN IF v::text !~ '^(0|[1-9][0-9]*)$' OR (v::text)::numeric>9007199254740991 THEN RAISE EXCEPTION 'Noncanonical number' USING ERRCODE='22023'; END IF; RETURN v::text;
 WHEN 'string' THEN
  -- PostgreSQL quotes and validates the scalar natively. Tokenize complete
  -- escape pairs so a literal backslash plus n stays distinct from newline.
  -- Convert only its five short control escapes to the grant's ASCII form.
  SELECT string_agg(CASE x[1]
   WHEN E'\\b' THEN E'\\u0008' WHEN E'\\t' THEN E'\\u0009'
   WHEN E'\\n' THEN E'\\u000a' WHEN E'\\f' THEN E'\\u000c'
   WHEN E'\\r' THEN E'\\u000d' ELSE x[1] END,'' ORDER BY ordinality)
   INTO result FROM regexp_matches(v::text,$re$\\.|[^\\]+$re$,'g') WITH ORDINALITY q(x,ordinality);
  RETURN result;
 WHEN 'array' THEN SELECT string_agg(assistant_chat_private.canonical(value),',' ORDER BY ordinality) INTO result FROM jsonb_array_elements(v) WITH ORDINALITY; RETURN '['||coalesce(result,'')||']';
 WHEN 'object' THEN
  IF v ? '$openplan_chat_nul_v1' THEN
   parts:=assistant_chat_private.string_parts(v);
   SELECT string_agg(substr(x,2,length(x)-2),E'\\u0000' ORDER BY ordinality) INTO result
    FROM (SELECT assistant_chat_private.canonical(value) x,ordinality FROM jsonb_array_elements(parts) WITH ORDINALITY) q;
   RETURN '"'||result||'"';
  END IF;
  SELECT string_agg(assistant_chat_private.canonical(to_jsonb(key))||':'||assistant_chat_private.canonical(value),',' ORDER BY key COLLATE "C") INTO result FROM jsonb_each(v); RETURN '{'||coalesce(result,'')||'}';
 ELSE RAISE EXCEPTION 'Noncanonical JSON' USING ERRCODE='22023'; END CASE;
END $$;
CREATE FUNCTION assistant_chat_private.sha(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,extensions AS $$ SELECT encode(extensions.digest(convert_to(v,'UTF8'),'sha256'),'hex') $$;
-- Identity only: retain installer ownership and platform auth.uid()/auth.jwt().
-- No domain query, caller argument, dynamic SQL or request-context setter belongs here.
CREATE FUNCTION assistant_chat_private.actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.jwt()->>'role' IS DISTINCT FROM 'authenticated' OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
  RAISE EXCEPTION 'Human session required' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;

-- All source mutations take the same workspace advisory lock before committing.
-- Cross-workspace moves lock old/new workspace keys in lexical order. Source
-- release never takes row locks, so no domain UPDATE privilege is needed.
CREATE FUNCTION assistant_chat_private.serialize_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_w text; new_w text; k text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_w:=to_jsonb(OLD)->>CASE WHEN TG_TABLE_NAME='workspaces' THEN 'id' ELSE 'workspace_id' END; END IF;
 IF TG_OP<>'DELETE' THEN new_w:=to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='workspaces' THEN 'id' ELSE 'workspace_id' END; END IF;
 FOR k IN SELECT DISTINCT x FROM unnest(ARRAY[old_w,new_w]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_chat_source:'||k,0));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER assistant_chat_source_serialization BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION assistant_chat_private.serialize_source();
CREATE TRIGGER assistant_chat_source_serialization BEFORE INSERT OR UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION assistant_chat_private.serialize_source();
CREATE TRIGGER assistant_chat_source_serialization BEFORE INSERT OR UPDATE OR DELETE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION assistant_chat_private.serialize_source();
CREATE TRIGGER assistant_chat_source_serialization BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_provider_api_connections FOR EACH ROW EXECUTE FUNCTION assistant_chat_private.serialize_source();

CREATE FUNCTION assistant_chat_private.append_event(p_turn uuid,p_kind text,p_body jsonb) RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE n bigint; prev text;
BEGIN
 UPDATE public.assistant_chat_turns SET cursor=cursor+1,revision=revision+1 WHERE id=p_turn RETURNING cursor INTO n;
 SELECT body_hash INTO prev FROM public.assistant_chat_events WHERE turn_id=p_turn AND sequence=n-1;
 INSERT INTO public.assistant_chat_events(turn_id,sequence,kind,body,body_hash,previous_hash)
 VALUES(p_turn,n,p_kind,p_body,assistant_chat_private.sha(assistant_chat_private.canonical(p_body)),prev);
 RETURN n;
END $$;
CREATE FUNCTION assistant_chat_private.dependencies(p_turn uuid) RETURNS text LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $$
 SELECT assistant_chat_private.sha(assistant_chat_private.canonical(jsonb_build_object(
  'sourceEnvelopeIds',coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM public.assistant_chat_sources WHERE turn_id=p_turn),'[]'),
  'anchorIds',coalesce((SELECT jsonb_agg(anchor ORDER BY anchor) FROM (SELECT DISTINCT a->>'anchorId' anchor FROM public.assistant_chat_sources s CROSS JOIN LATERAL jsonb_array_elements(s.envelope->'accessAnchors') a WHERE turn_id=p_turn) anchors),'[]'))))
$$;
CREATE FUNCTION assistant_chat_private.record_check(p_turn uuid,p_purpose text,p_body_hash text) RETURNS void LANGUAGE sql SET search_path=pg_catalog,public AS $$
 INSERT INTO public.assistant_chat_access_checks(owner_user_id,workspace_id,turn_id,attempt_id,grant_digest,purpose,exact_body_hash,dependency_set_hash,result)
 SELECT t.owner_user_id,t.workspace_id,t.id,t.attempt_id,g.digest,p_purpose,p_body_hash,assistant_chat_private.dependencies(t.id),'allowed'
 FROM public.assistant_chat_turns t JOIN public.assistant_chat_grants g ON g.id=t.grant_id WHERE t.id=p_turn
$$;
CREATE FUNCTION assistant_chat_private.require_access(p_turn uuid,p_digest text,p_purpose text,p_body_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE human_id uuid:=assistant_chat_private.actor(); t public.assistant_chat_turns; g public.assistant_chat_grants; grant_body jsonb; selection jsonb; a jsonb; e record; capability public.assistant_chat_admissions; okay boolean:=true; failed jsonb:='[]';
BEGIN
 -- Lock order: sorted workspace source anchors (includes every membership,
 -- workspace/project/index/connection mutation), then grant, turn, step/tool,
 -- intent, approval, finally shared staff-meter lock. No service source read.
 SELECT * INTO t FROM public.assistant_chat_turns WHERE id=p_turn AND owner_user_id=human_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat owner denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('assistant_chat_source:'||t.workspace_id::text,0));
 -- Acquire ordinary SELECT relation locks before the policy fingerprint. A
 -- concurrent policy DDL change must not race a read using its pinned clone.
 PERFORM id FROM public.workspaces WHERE false;
 PERFORM workspace_id FROM public.workspace_members WHERE false;
 PERFORM id FROM public.projects WHERE false;
 PERFORM id FROM public.workspace_provider_api_connections WHERE false;
 PERFORM id FROM public.workspace_provider_api_revisions WHERE false;
 PERFORM workspace_id FROM public.usage_events WHERE false;
 PERFORM id FROM public.assistant_action_approvals WHERE false;
 PERFORM approval_id FROM public.assistant_action_executions WHERE false;
 SELECT * INTO g FROM public.assistant_chat_grants WHERE id=t.grant_id FOR UPDATE;
 SELECT * INTO t FROM public.assistant_chat_turns WHERE id=p_turn FOR UPDATE;
 IF t.state='access_lost' THEN RETURN false; END IF;
 IF t.state IN ('cancelled','interrupted','uncertain','failed') OR g.digest IS DISTINCT FROM p_digest OR g.status='revoked' OR g.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 grant_body:=assistant_chat_private.lossless(g.canonical::json); selection:=grant_body->'selection';
 IF current_setting('server_encoding')<>'UTF8' OR EXISTS(SELECT 1 FROM assistant_chat_private.source_policy_pins WHERE fingerprint<>assistant_chat_private.policy_fingerprint(table_oid))
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='openplan_chat_authorizer' AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='openplan_chat_authorizer'::regrole)
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.workspaces'::regclass,'public.workspace_members'::regclass,'public.projects'::regclass) AND relowner='openplan_chat_authorizer'::regrole)
  OR has_table_privilege('openplan_chat_authorizer','public.projects','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('openplan_chat_authorizer','public.workspaces','INSERT,UPDATE,DELETE,TRUNCATE')
  OR has_table_privilege('openplan_chat_authorizer','public.workspace_members','INSERT,UPDATE,DELETE,TRUNCATE') THEN
  UPDATE public.assistant_chat_turns SET state='unassessed',failure_code='chat_policy_unassessed' WHERE id=t.id; RETURN false;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=t.workspace_id AND user_id=human_id AND lower(trim(role)) IN ('owner','admin','member','viewer'))
  OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=t.workspace_id) THEN okay:=false; failed:=failed||jsonb_build_array('membership:'||t.workspace_id::text||':'||human_id::text,'workspace:'||t.workspace_id::text); END IF;
 FOR e IN SELECT envelope FROM public.assistant_chat_sources WHERE turn_id=t.id ORDER BY id LOOP
  FOR a IN SELECT value FROM jsonb_array_elements(e.envelope->'accessAnchors') LOOP
   IF a->>'workspaceId' IS DISTINCT FROM t.workspace_id::text THEN okay:=false; failed:=failed||jsonb_build_array(a->>'anchorId'); END IF;
   IF a->>'kind'='project' AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(a->>'projectId')::uuid AND workspace_id=t.workspace_id) THEN okay:=false; failed:=failed||jsonb_build_array(a->>'anchorId'); END IF;
  END LOOP;
 END LOOP;
 IF NOT okay THEN
  UPDATE public.assistant_chat_turns SET state='access_lost',failure_code='chat_source_access_lost' WHERE id=t.id;
  INSERT INTO public.assistant_chat_access_checks(owner_user_id,workspace_id,turn_id,attempt_id,grant_digest,purpose,exact_body_hash,dependency_set_hash,result,failed_anchor_ids,failure_code)
   VALUES(t.owner_user_id,t.workspace_id,t.id,t.attempt_id,g.digest,p_purpose,p_body_hash,assistant_chat_private.dependencies(t.id),'access_lost',failed,'chat_source_access_lost');
  PERFORM assistant_chat_private.append_event(t.id,'access_lost','{}'); RETURN false;
 END IF;
 SELECT * INTO capability FROM public.assistant_chat_admissions WHERE id=(selection->>'capabilityRecordId')::uuid;
 IF NOT FOUND OR NOT capability.admitted OR capability.revoked_at IS NOT NULL OR capability.record_hash IS DISTINCT FROM selection->>'capabilityRecordHash'
  OR capability.record_canonical::jsonb->'selection' IS DISTINCT FROM (selection-'capabilityRecordId'-'capabilityRecordHash'-'chargeAcknowledgment'-'costDisclosure')
  OR capability.record_canonical::jsonb->>'profileCanonical' IS DISTINCT FROM grant_body->'profile'->>'definitionCanonical'
  OR capability.record_canonical::jsonb->>'projectionCanonical' IS DISTINCT FROM grant_body->'scope'->>'projectionDefinitions'
  OR NOT ((capability.record_canonical::jsonb->'catalogCanonicals') ? (grant_body->'catalog'->>'definitionCanonical'))
  OR NOT EXISTS(SELECT 1 FROM public.workspace_provider_api_connections c JOIN public.workspace_provider_api_revisions r ON r.id=c.current_revision_id
   WHERE c.id=(selection->>'connectionId')::uuid AND c.workspace_id=t.workspace_id AND c.revoked_at IS NULL AND r.id=(selection->>'revisionId')::uuid
    AND r.configuration_canonical=selection->>'configurationCanonical' AND r.configuration_hash=selection->>'configurationHash') THEN
  UPDATE public.assistant_chat_turns SET state='interrupted',failure_code='chat_selection_unavailable' WHERE id=t.id; RETURN false;
 END IF;
 -- Observational reads retain their current access check in the private ledger.
 -- Polling must not append to the progress stream it is trying to drain.
 IF p_purpose IN ('read','intent_read') THEN
  PERFORM assistant_chat_private.record_check(t.id,p_purpose,p_body_hash);
 ELSE
  PERFORM assistant_chat_private.append_event(t.id,'scope_checked',jsonb_build_object('purpose',p_purpose,'bindingHash',p_body_hash,
   'dependencySetHash',assistant_chat_private.dependencies(t.id),'checkId',gen_random_uuid(),'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 END IF;
 RETURN true;
END $$;

-- Reconstruct the precise wire transcript from the accepted initial packet and
-- completed retained results. A caller-supplied transcript is not authority.
-- Compare only nested argument JSON by logical value, as the JS wire guard does.
-- Keep every surrounding field, call identity and exact original request byte/hash.
CREATE FUNCTION assistant_chat_private.normalize_wire_arguments(messages jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE m jsonb; c jsonb; mi int:=0; ci int; args text;
BEGIN
 IF jsonb_typeof(messages) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid chat messages' USING ERRCODE='22023'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(messages) LOOP
  IF m->>'role'='assistant' AND m ? 'tool_calls' THEN
   IF jsonb_typeof(m->'tool_calls') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid chat tool calls' USING ERRCODE='22023'; END IF;
   ci:=0;
   FOR c IN SELECT value FROM jsonb_array_elements(m->'tool_calls') LOOP
    IF jsonb_typeof(c->'function'->'arguments') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid chat arguments' USING ERRCODE='22023'; END IF;
    args:=assistant_chat_private.canonical(assistant_chat_private.lossless((c->'function'->>'arguments')::json));
    messages:=jsonb_set(messages,ARRAY[mi::text,'tool_calls',ci::text,'function','arguments'],to_jsonb(args),false);
    ci:=ci+1;
   END LOOP;
  END IF;
  mi:=mi+1;
 END LOOP;
 RETURN messages;
END $$;

CREATE FUNCTION assistant_chat_private.expected_messages(p_turn uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE g jsonb; messages jsonb; sources jsonb; st record; call jsonb; row public.assistant_chat_tool_calls; assistant jsonb; calls jsonb;
BEGIN
 SELECT assistant_chat_private.lossless(x.canonical::json) INTO g FROM public.assistant_chat_grants x JOIN public.assistant_chat_turns t ON t.grant_id=x.id WHERE t.id=p_turn;
 SELECT jsonb_agg(jsonb_build_object('envelopeId',e->>'envelopeId','dataClass',e->>'dataClass','capturedAt',e->>'capturedAt',
  'content',assistant_chat_private.lossless((e->>'canonicalProjectedContent')::json),'omissions',e->'omissions','truncation',e->'truncation') ORDER BY ordinality) INTO sources FROM jsonb_array_elements(g->'packet'->'initialEnvelopes') WITH ORDINALITY e(e,ordinality);
 messages:=jsonb_build_array(jsonb_build_object('role','system','content',(g->'profile'->>'definitionCanonical')::jsonb->>'systemInstructions'),
  jsonb_build_object('role','user','content',assistant_chat_private.canonical(jsonb_build_object('question',g->'packet'->'question','target',g->'scope'->'target','history','[]'::jsonb,'sources',sources))));
 FOR st IN SELECT * FROM public.assistant_chat_steps WHERE turn_id=p_turn ORDER BY sequence LOOP
  IF st.state<>'completed' OR st.receipt IS NULL THEN RAISE EXCEPTION 'Prior step is uncertain' USING ERRCODE='PT409'; END IF;
  assistant:=jsonb_build_object('role','assistant','content',nullif(st.receipt->'text','""'::jsonb));
  SELECT jsonb_agg(jsonb_build_object('id',c->>'toolCallId','type','function','function',jsonb_build_object('name',c->>'name','arguments',c->>'argumentsCanonical')) ORDER BY ordinality)
   INTO calls FROM jsonb_array_elements(st.receipt->'calls') WITH ORDINALITY c(c,ordinality);
  IF calls IS NOT NULL THEN assistant:=assistant||jsonb_build_object('tool_calls',calls); END IF;
  messages:=messages||jsonb_build_array(assistant);
  FOR call IN SELECT value FROM jsonb_array_elements(st.receipt->'calls') LOOP
   SELECT * INTO row FROM public.assistant_chat_tool_calls WHERE turn_id=p_turn AND step_id=st.id AND call_id=call->>'toolCallId';
   IF NOT FOUND OR row.state<>'completed' OR row.result_hash IS DISTINCT FROM assistant_chat_private.sha(assistant_chat_private.canonical(row.result)) THEN RAISE EXCEPTION 'Tool result is uncertain' USING ERRCODE='PT409'; END IF;
   messages:=messages||jsonb_build_array(jsonb_build_object('role','tool','tool_call_id',row.call_id,'content',assistant_chat_private.canonical(row.result)));
  END LOOP;
 END LOOP;
 RETURN messages;
END $$;

-- Validate the closed source graph before a server capture enters custody.
CREATE FUNCTION assistant_chat_private.store_sources(p_turn uuid,p_sources jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE t public.assistant_chat_turns; g jsonb; e jsonb; a jsonb; content jsonb; keys text[]; p uuid; existing public.assistant_chat_sources;
BEGIN
 SELECT * INTO t FROM public.assistant_chat_turns WHERE id=p_turn;
 IF jsonb_typeof(p_sources)<>'array' THEN RAISE EXCEPTION 'Invalid sources' USING ERRCODE='22023'; END IF;
 IF p_sources='[]'::jsonb THEN RETURN; END IF;
 SELECT assistant_chat_private.lossless(canonical::json) INTO g FROM public.assistant_chat_grants WHERE id=t.grant_id;
 FOR e IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
  IF assistant_chat_private.keys_exact(e,ARRAY['envelopeId','turnId','stepId','dataClass','projectionId','projectionRevision','capturedAt','sources','accessAnchors','queryDependency','canonicalProjectedContent','contentHash','availability','omissions','truncation']) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid envelope fields' USING ERRCODE='22023'; END IF;
  IF e->>'turnId' IS DISTINCT FROM t.id::text OR e->>'projectionId'<>'assistant_chat_minimal_context_v1' OR e->>'projectionRevision'<>'1'
    OR e->>'availability'<>'available' OR e->>'contentHash' IS DISTINCT FROM assistant_chat_private.sha(e->>'canonicalProjectedContent') THEN RAISE EXCEPTION 'Invalid source identity' USING ERRCODE='22023'; END IF;
  content:=assistant_chat_private.lossless((e->>'canonicalProjectedContent')::json);
  IF assistant_chat_private.canonical(content) IS DISTINCT FROM e->>'canonicalProjectedContent' THEN RAISE EXCEPTION 'Invalid source canonical bytes' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'accessAnchors') anchor WHERE anchor->>'kind'='membership' AND anchor->>'primaryKey'=t.workspace_id::text||':'||t.owner_user_id::text)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'accessAnchors') anchor WHERE anchor->>'kind'='workspace' AND anchor->>'primaryKey'=t.workspace_id::text) THEN RAISE EXCEPTION 'Missing source anchors' USING ERRCODE='22023'; END IF;
  CASE e->>'dataClass'
  WHEN 'workspace_identity' THEN keys:=ARRAY['workspaceId','workspaceName']; IF content->>'workspaceId' IS DISTINCT FROM t.workspace_id::text THEN RAISE EXCEPTION 'Workspace mismatch'; END IF;
  WHEN 'selected_project_summary' THEN
   keys:=ARRAY['id','name','summary','status','planType','deliveryPhase','updatedAt','href']; p:=(content->>'id')::uuid;
   IF NOT (g->'scope'->'selectedProjectIds') ? p::text OR content->>'href' IS DISTINCT FROM '/projects/'||p::text
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'accessAnchors') anchor WHERE anchor->>'kind'='project' AND anchor->>'projectId'=p::text) THEN RAISE EXCEPTION 'Project not selected' USING ERRCODE='42501'; END IF;
  WHEN 'workspace_project_index' THEN
   keys:=ARRAY['rows','returnedCount','possiblyTruncated'];
   IF g->'scope'->>'includeWorkspaceIndex' IS DISTINCT FROM 'true' OR jsonb_array_length(content->'rows')>25
    OR (content->>'returnedCount')::int<>jsonb_array_length(content->'rows') OR (content->>'possiblyTruncated')::boolean<>(jsonb_array_length(content->'rows')=25)
    OR e->'queryDependency'->>'workspaceId' IS DISTINCT FROM t.workspace_id::text
    OR e->'queryDependency'->>'columns' IS DISTINCT FROM 'id, workspace_id, name, status, delivery_phase, updated_at'
    OR e->'queryDependency'->'order' IS DISTINCT FROM '["updated_at DESC","id ASC"]'::jsonb OR e->'queryDependency'->>'limit'<>'25' THEN RAISE EXCEPTION 'Index not accepted' USING ERRCODE='42501'; END IF;
   FOR a IN SELECT value FROM jsonb_array_elements(content->'rows') LOOP
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(a) key) IS DISTINCT FROM ARRAY['deliveryPhase','id','name','status','updatedAt']
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e->'accessAnchors') x WHERE x->>'kind'='project' AND x->>'projectId'=a->>'id') THEN RAISE EXCEPTION 'Index lineage missing' USING ERRCODE='22023'; END IF;
   END LOOP;
  ELSE RAISE EXCEPTION 'Source class not admitted' USING ERRCODE='22023'; END CASE;
  IF (SELECT count(*) FROM jsonb_object_keys(content))<>cardinality(keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(content) k WHERE NOT k=ANY(keys)) THEN RAISE EXCEPTION 'Source fields not admitted' USING ERRCODE='22023'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(e->'accessAnchors') LOOP
   IF assistant_chat_private.keys_exact(a,ARRAY['anchorId','kind','table','primaryKey','workspaceId','projectId','permission','projectionId','projectionRevision','observedVersion','observedAt']) IS NOT TRUE
    OR a->>'kind' NOT IN ('membership','workspace','project','index_query')
    OR (a->>'kind'='membership' AND (a->>'table'<>'workspace_members' OR a->>'primaryKey' IS DISTINCT FROM t.workspace_id::text||':'||t.owner_user_id::text))
    OR (a->>'kind'='workspace' AND (a->>'table'<>'workspaces' OR a->>'primaryKey' IS DISTINCT FROM t.workspace_id::text))
    OR (a->>'kind'='project' AND (a->>'table'<>'projects' OR a->>'primaryKey' IS DISTINCT FROM a->>'projectId')) THEN RAISE EXCEPTION 'Invalid contributing identity' USING ERRCODE='22023'; END IF;
   IF a->>'workspaceId' IS DISTINCT FROM t.workspace_id::text OR a->>'permission'<>'read' OR a->>'projectionId'<>'assistant_chat_minimal_context_v1' THEN RAISE EXCEPTION 'Invalid access anchor'; END IF;
   IF a->>'kind'='project' AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(a->>'projectId')::uuid AND workspace_id=t.workspace_id) THEN RAISE EXCEPTION 'Project access lost' USING ERRCODE='42501'; END IF;
  END LOOP;
  SELECT * INTO existing FROM public.assistant_chat_sources WHERE id=(e->>'envelopeId')::uuid;
  IF FOUND THEN IF existing.turn_id<>t.id OR existing.envelope IS DISTINCT FROM e THEN RAISE EXCEPTION 'Source retry conflict' USING ERRCODE='PT409'; END IF;
  ELSE INSERT INTO public.assistant_chat_sources VALUES((e->>'envelopeId')::uuid,t.id,e,e->>'contentHash'); END IF;
 END LOOP;
END $$;

CREATE FUNCTION assistant_chat_private.keys_exact(v jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN v ?& keys AND (SELECT count(*) FROM jsonb_object_keys(v))=cardinality(keys) ELSE false END
$$;
CREATE FUNCTION assistant_chat_private.valid_tool_input(n text,v jsonb,g jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,assistant_chat_private AS $$
BEGIN
 IF n='list_projects' THEN RETURN v='{}'::jsonb AND g->'scope'->>'includeWorkspaceIndex'='true'; END IF;
 IF n='get_surface_context' THEN RETURN assistant_chat_private.keys_exact(v,ARRAY['kind','id']) AND v->>'kind'='project' AND (g->'scope'->'selectedProjectIds') ? (v->>'id'); END IF;
 IF n='propose_create_project_record' THEN RETURN assistant_chat_private.keys_exact(v,ARRAY['projectId','title','submittalType','notes'])
  AND (g->'scope'->'selectedProjectIds') ? (v->>'projectId') AND assistant_chat_private.is_string(v->'title') AND assistant_chat_private.string_length(assistant_chat_private.trim_string(v->'title')) BETWEEN 1 AND 160
  AND v->>'submittalType' IN ('authorization_packet','invoice_backup','environmental_package','hearing_record','ps_e','reimbursement','progress_report','other')
  AND assistant_chat_private.is_string(v->'notes') AND assistant_chat_private.string_length(assistant_chat_private.trim_string(v->'notes'))<=4000; END IF;
 RETURN false;
END $$;
CREATE FUNCTION assistant_chat_private.valid_grant_shape(b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,assistant_chat_private AS $$
 SELECT assistant_chat_private.keys_exact(b,ARRAY['domain','version','grantId','prepareRequestId','acceptanceRequestId','turnRequestId','turnId','owner','task','profile','catalog','scope','packet','selection','preparedAt','acceptBefore','expiresAt'])
 AND assistant_chat_private.keys_exact(b->'owner',ARRAY['userId','workspaceId','installationId','appOrigin'])
 AND assistant_chat_private.keys_exact(b->'profile',ARRAY['id','revision','definitionHash','definitionCanonical','projectionId','projectionRevision','limits'])
 AND assistant_chat_private.keys_exact(b->'catalog',ARRAY['revision','definitionHash','definitionCanonical','tools'])
 AND assistant_chat_private.keys_exact(b->'scope',ARRAY['target','selectedProjectIds','includeWorkspaceIndex','dataClasses','resourceRules','projectionDefinitions','historyPolicy'])
 AND assistant_chat_private.keys_exact(b->'scope'->'target',ARRAY['kind','id','workspaceId'])
 AND assistant_chat_private.keys_exact(b->'packet',ARRAY['version','question','history','capturedAt','initialEnvelopes'])
 AND assistant_chat_private.keys_exact(b->'selection',ARRAY['kind','provider','connectionId','revisionId','configurationCanonical','configurationHash','protocol','endpoint','modelId','authMode','authRevision','credentialSource','capabilityRecordId','capabilityRecordHash','execution','chargeAcknowledgment','costDisclosure'])
 AND assistant_chat_private.keys_exact(b->'selection'->'authRevision',ARRAY['revisionId','credentialBindingRevision'])
 AND assistant_chat_private.keys_exact(b->'selection'->'credentialSource',ARRAY['kind','connectionId'])
 AND assistant_chat_private.keys_exact(b->'selection'->'execution',ARRAY['kind','installationId','poolId','poolConfigurationRevision'])
 AND assistant_chat_private.keys_exact(b->'selection'->'chargeAcknowledgment',ARRAY['accepted','acknowledgedByUserId','disclosureVersion','mode'])
 AND assistant_chat_private.keys_exact(b->'selection'->'costDisclosure',ARRAY['status','reason','pricingSource','pricingRevision','pricingAsOf','currency','rateBasis','inputRate','outputRate','estimatedTotal','estimateAssumptions','providerBillingUncertain'])
 AND b->'selection'->'costDisclosure'->>'status'='unknown' AND length(b->'selection'->'costDisclosure'->>'reason')>0
 AND ((b->'selection'->'costDisclosure')-'status'-'reason')='{"pricingSource":null,"pricingRevision":null,"pricingAsOf":null,"currency":null,"rateBasis":null,"inputRate":null,"outputRate":null,"estimatedTotal":null,"estimateAssumptions":null,"providerBillingUncertain":true}'::jsonb
 AND b->>'preparedAt' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 AND b->>'acceptBefore' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
 AND b->>'expiresAt' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
$$;

CREATE FUNCTION assistant_chat_private.valid_terminal(r jsonb,g jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,assistant_chat_private AS $$
DECLARE raw text:=r->>'rawBody'; f text; frames text[]; v jsonb; ch jsonb; d jsonb; tc jsonb; fn jsonb; built jsonb:='[]'; outputs jsonb:='[]';
 item jsonb; arg jsonb; u jsonb; usage jsonb; response_id text; text_body jsonb:='""'; reason text; done boolean:=false; idx int; count_frames int:=0; key text;
BEGIN
 IF assistant_chat_private.keys_exact(r,ARRAY['version','responseId','model','reason','bodyHash','rawBody','responseBytes','inputTokens','outputTokens','text','calls','frameCount']) IS NOT TRUE
  OR r->>'version' IS DISTINCT FROM '1' OR r->>'model' IS DISTINCT FROM g->'selection'->>'modelId' OR r->>'bodyHash' IS DISTINCT FROM assistant_chat_private.sha(raw)
  OR octet_length(raw) NOT BETWEEN 1 AND 512000 OR octet_length(raw)<>(r->>'responseBytes')::int OR right(raw,2)<>E'\n\n' OR position(E'\r' IN raw)>0 THEN RETURN false; END IF;
 frames:=string_to_array(raw,E'\n\n');
 FOREACH f IN ARRAY frames[1:cardinality(frames)-1] LOOP
  count_frames:=count_frames+1;
  IF done OR count_frames>4096 OR octet_length(f)>64000 OR left(f,6)<>'data: ' OR position(E'\n' IN f)>0 THEN RETURN false; END IF;
  IF f='data: [DONE]' THEN IF reason IS NULL THEN RETURN false; END IF; done:=true; CONTINUE; END IF;
  v:=assistant_chat_private.lossless(substr(f,7)::json);
  IF assistant_chat_private.keys_exact(v,ARRAY['id','object','created','model','choices']||CASE WHEN v ? 'usage' THEN ARRAY['usage'] ELSE ARRAY[]::text[] END) IS NOT TRUE
   OR jsonb_typeof(v->'id')<>'string' OR v->>'id' !~ '^[A-Za-z0-9_-]{1,200}$' OR v->>'object' IS DISTINCT FROM 'chat.completion.chunk'
   OR v->>'model' IS DISTINCT FROM g->'selection'->>'modelId' OR (response_id IS NOT NULL AND v->>'id' IS DISTINCT FROM response_id)
   OR jsonb_typeof(v->'created')<>'number' OR (v->>'created')::numeric NOT BETWEEN 0 AND 9007199254740991
   OR (v->>'created')::numeric<>trunc((v->>'created')::numeric) OR jsonb_typeof(v->'choices')<>'array' OR jsonb_array_length(v->'choices')>1 THEN RETURN false; END IF;
  response_id:=v->>'id';
  IF v->'usage' IS NOT NULL AND v->'usage'<>'null'::jsonb THEN
   u:=v->'usage'; IF usage IS NOT NULL OR assistant_chat_private.keys_exact(u,ARRAY['prompt_tokens','completion_tokens','total_tokens']) IS NOT TRUE THEN RETURN false; END IF;
   FOREACH key IN ARRAY ARRAY['prompt_tokens','completion_tokens','total_tokens'] LOOP
    IF jsonb_typeof(u->key)<>'number' OR (u->>key)::numeric NOT BETWEEN 0 AND 9007199254740991 OR (u->>key)::numeric<>trunc((u->>key)::numeric) THEN RETURN false; END IF;
   END LOOP;
   IF (u->>'completion_tokens')::int>2000 OR (u->>'total_tokens')::numeric<>(u->>'prompt_tokens')::numeric+(u->>'completion_tokens')::numeric THEN RETURN false; END IF; usage:=u;
  END IF;
  IF jsonb_array_length(v->'choices')=0 THEN IF reason IS NULL OR v->'usage' IS NULL OR v->'usage'='null'::jsonb THEN RETURN false; END IF; CONTINUE; END IF;
  IF reason IS NOT NULL THEN RETURN false; END IF;
  ch:=v->'choices'->0;
  IF assistant_chat_private.keys_exact(ch,ARRAY['index','delta','finish_reason']) IS NOT TRUE OR ch->'index'<>'0'::jsonb OR jsonb_typeof(ch->'delta')<>'object' THEN RETURN false; END IF;
  d:=ch->'delta';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('role','content','tool_calls')) OR (d ? 'role' AND d->>'role' IS DISTINCT FROM 'assistant') THEN RETURN false; END IF;
  IF d ? 'content' AND d->'content'<>'null'::jsonb THEN IF NOT assistant_chat_private.is_string(d->'content') THEN RETURN false; END IF; text_body:=assistant_chat_private.string_concat(text_body,d->'content'); END IF;
  IF d ? 'tool_calls' THEN
   IF jsonb_typeof(d->'tool_calls')<>'array' OR jsonb_array_length(d->'tool_calls')>12 THEN RETURN false; END IF;
   FOR tc IN SELECT value FROM jsonb_array_elements(d->'tool_calls') LOOP
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(tc) k WHERE k NOT IN ('index','id','type','function')) OR NOT tc ?& ARRAY['index','function']
     OR jsonb_typeof(tc->'index')<>'number' OR (tc->>'index')::numeric<>trunc((tc->>'index')::numeric) OR (tc->>'index')::int NOT BETWEEN 0 AND 11
     OR jsonb_typeof(tc->'function')<>'object' THEN RETURN false; END IF;
    fn:=tc->'function'; idx:=(tc->>'index')::int;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(fn) k WHERE k NOT IN ('name','arguments')) OR (fn ? 'arguments' AND jsonb_typeof(fn->'arguments')<>'string') THEN RETURN false; END IF;
    IF idx=jsonb_array_length(built) THEN
     IF tc->>'type' IS DISTINCT FROM 'function' OR jsonb_typeof(tc->'id')<>'string' OR tc->>'id' !~ '^[A-Za-z0-9_-]{1,200}$'
      OR NOT (g->'catalog'->'tools') ? (fn->>'name') OR EXISTS(SELECT 1 FROM jsonb_array_elements(built) x WHERE x->>'id'=tc->>'id') THEN RETURN false; END IF;
     built:=built||jsonb_build_array(jsonb_build_object('id',tc->>'id','name',fn->>'name','arguments',''));
    ELSIF idx>jsonb_array_length(built) OR tc ?| ARRAY['id','type'] OR fn ? 'name' THEN RETURN false; END IF;
    built:=jsonb_set(built,ARRAY[idx::text,'arguments'],to_jsonb((built->idx->>'arguments')||coalesce(fn->>'arguments','')));
    IF octet_length(built->idx->>'arguments')>16000 THEN RETURN false; END IF;
   END LOOP;
  END IF;
  IF ch->'finish_reason'<>'null'::jsonb THEN
   IF ch->>'finish_reason' NOT IN ('stop','tool_calls') THEN RETURN false; END IF; reason:=ch->>'finish_reason';
  END IF;
 END LOOP;
 IF NOT done OR reason IS NULL OR (reason='stop' AND jsonb_array_length(built)<>0) OR (reason='tool_calls' AND jsonb_array_length(built)=0) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(built) LOOP
  arg:=assistant_chat_private.lossless((item->>'arguments')::json);
  IF item->>'name'='propose_create_project_record' THEN arg:=jsonb_set(jsonb_set(arg,'{title}',assistant_chat_private.trim_string(arg->'title')),'{notes}',assistant_chat_private.trim_string(arg->'notes')); END IF;
  IF assistant_chat_private.valid_tool_input(item->>'name',arg,g) IS NOT TRUE THEN RETURN false; END IF;
  outputs:=outputs||jsonb_build_array(jsonb_build_object('toolCallId',item->>'id','name',item->>'name','input',arg,'argumentsCanonical',assistant_chat_private.canonical(arg)));
 END LOOP;
 RETURN r->>'responseId'=response_id AND r->>'reason'=reason AND r->'text'=text_body AND r->'calls'=outputs AND (r->>'frameCount')::int=count_frames
  AND r->'inputTokens' IS NOT DISTINCT FROM coalesce(usage->'prompt_tokens','null'::jsonb) AND r->'outputTokens' IS NOT DISTINCT FROM coalesce(usage->'completion_tokens','null'::jsonb);
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE FUNCTION assistant_chat_private.delta_text(p_turn uuid,p_step uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb:='""'; e record;
BEGIN
 FOR e IN SELECT body->'text' value FROM public.assistant_chat_events WHERE turn_id=p_turn AND kind='text_delta' AND body->>'stepId'=p_step::text ORDER BY (body->>'frameSequence')::int LOOP
  result:=assistant_chat_private.string_concat(result,e.value);
 END LOOP; RETURN result;
END $$;

-- One session entry point with a closed operation inventory. Each release
-- performs its own current-RLS check; no check ID can be supplied as authority.
CREATE FUNCTION assistant_chat_private.session(p_operation text,p_turn_id uuid,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,assistant_chat_private AS $$
#variable_conflict use_variable
DECLARE actor uuid:=assistant_chat_private.actor(); t public.assistant_chat_turns; g public.assistant_chat_grants;
 b jsonb; s jsonb; r jsonb; e jsonb; c jsonb; call_row public.assistant_chat_tool_calls; step public.assistant_chat_steps;
 n bigint; seq int; recent bigint; body text; h text; result jsonb; intent public.assistant_chat_proposal_intents; action jsonb; iid uuid;
BEGIN
 IF p_operation='options' THEN
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=(p_payload->>'workspaceId')::uuid AND user_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace denied' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'recordCanonical',record_canonical,'recordHash',record_hash) ORDER BY id),'[]') INTO result
   FROM public.assistant_chat_admissions WHERE admitted AND revoked_at IS NULL AND record_canonical::jsonb->>'workspaceId'=p_payload->>'workspaceId';
  RETURN jsonb_build_object('admissions',result);
 END IF;
 IF p_operation='history' THEN
  SELECT coalesce(jsonb_agg(row),'[]') INTO result FROM (SELECT id,state,cursor,failure_code,created_at FROM public.assistant_chat_turns
   WHERE owner_user_id=actor AND workspace_id=(p_payload->>'workspaceId')::uuid ORDER BY created_at DESC,id LIMIT 25) row;
  RETURN jsonb_build_object('turns',result);
 END IF;
 IF p_operation='lookup_prepare' THEN
  SELECT * INTO g FROM public.assistant_chat_grants WHERE owner_user_id=actor AND prepare_request_id=(p_payload->>'prepareRequestId')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  SELECT * INTO t FROM public.assistant_chat_turns WHERE grant_id=g.id;
  RETURN assistant_chat_private.session('read',t.id,'{}')||jsonb_build_object('found',true);
 END IF;
 IF p_operation='prepare' THEN
  body:=p_payload->>'canonical'; b:=assistant_chat_private.lossless(body::json); h:=assistant_chat_private.sha(E'OpenPlan.AssistantChatGrant.v1\n'||body);
  IF assistant_chat_private.valid_grant_shape(b) IS NOT TRUE OR assistant_chat_private.canonical(b) IS DISTINCT FROM body OR h IS DISTINCT FROM p_payload->>'digest' OR octet_length(body)>240000
   OR b->>'domain'<>'OpenPlan.AssistantChatGrant' OR b->>'version'<>'1' OR b->'task' IS DISTINCT FROM '{"family":"assistant_chat","version":1}'::jsonb
   OR b->'owner'->>'userId' IS DISTINCT FROM actor::text OR b->>'turnId' IS DISTINCT FROM p_turn_id::text
   OR b->'owner'->>'workspaceId' IS DISTINCT FROM b->'scope'->'target'->>'workspaceId'
   OR b->'selection'->>'kind'<>'saved_api' OR b->'selection'->>'provider'<>'api_connection'
   OR b->'selection'->'chargeAcknowledgment'->>'accepted'<>'true' OR b->'selection'->'chargeAcknowledgment'->>'acknowledgedByUserId' IS DISTINCT FROM actor::text
   OR b->'packet'->'history' IS DISTINCT FROM '[]'::jsonb OR b->'scope'->>'historyPolicy'<>'none'
   OR b->'profile'->>'id'<>'chat_completions_tools_v1' OR b->'profile'->>'revision'<>'1'
   OR b->'profile'->'limits' IS DISTINCT FROM '{"modelSteps":6,"outputTokensPerStep":2000,"outputTokensTotal":12000,"toolCalls":12,"knowledgeBaseSearches":0,"requestBytesPerStep":256000,"responseBytesPerStep":512000,"responseBytesTotal":3072000,"toolResultBytesPerCall":64000,"toolResultBytesTotal":768000}'::jsonb
   OR b->'profile'->>'definitionHash' IS DISTINCT FROM assistant_chat_private.sha(b->'profile'->>'definitionCanonical')
   OR b->'catalog'->>'definitionHash' IS DISTINCT FROM assistant_chat_private.sha(b->'catalog'->>'definitionCanonical')
   OR assistant_chat_private.string_length(b->'packet'->'question') NOT BETWEEN 1 AND 2000 OR jsonb_array_length(b->'scope'->'selectedProjectIds')>25
   OR (b->>'acceptBefore')::timestamptz<=clock_timestamp() OR (b->>'expiresAt')::timestamptz<=(b->>'acceptBefore')::timestamptz
   OR (b->>'expiresAt')::timestamptz>clock_timestamp()+interval '30 minutes' THEN RAISE EXCEPTION 'Invalid chat grant' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_chat_source:'||(b->'owner'->>'workspaceId'),0));
  SELECT * INTO g FROM public.assistant_chat_grants WHERE owner_user_id=actor AND prepare_request_id=(b->>'prepareRequestId')::uuid FOR UPDATE;
  IF FOUND THEN IF g.digest<>h THEN RAISE EXCEPTION 'Prepared grant changed' USING ERRCODE='PT409'; END IF;
  ELSE
   INSERT INTO public.assistant_chat_grants(id,owner_user_id,workspace_id,prepare_request_id,acceptance_request_id,turn_request_id,canonical,digest,accept_before,expires_at)
    VALUES((b->>'grantId')::uuid,actor,(b->'owner'->>'workspaceId')::uuid,(b->>'prepareRequestId')::uuid,(b->>'acceptanceRequestId')::uuid,(b->>'turnRequestId')::uuid,body,h,(b->>'acceptBefore')::timestamptz,(b->>'expiresAt')::timestamptz) RETURNING * INTO g;
   INSERT INTO public.assistant_chat_turns(id,grant_id,owner_user_id,workspace_id) VALUES(p_turn_id,g.id,actor,g.workspace_id);
   PERFORM assistant_chat_private.store_sources(p_turn_id,b->'packet'->'initialEnvelopes');
  END IF;
 END IF;
 SELECT * INTO t FROM public.assistant_chat_turns WHERE id=p_turn_id AND owner_user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat owner denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM public.assistant_chat_grants WHERE id=t.grant_id;
 IF p_operation IN ('metadata','cancel') THEN
  IF p_operation='cancel' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('assistant_chat_source:'||t.workspace_id::text,0));
   SELECT * INTO g FROM public.assistant_chat_grants WHERE id=t.grant_id FOR UPDATE;
   SELECT * INTO t FROM public.assistant_chat_turns WHERE id=t.id FOR UPDATE;
   UPDATE public.assistant_chat_grants SET status='revoked',revoked_at=clock_timestamp() WHERE id=g.id;
   IF t.state NOT IN ('access_lost','succeeded') THEN UPDATE public.assistant_chat_turns SET state='cancelled',failure_code='chat_cancelled' WHERE id=t.id RETURNING * INTO t; END IF;
   PERFORM assistant_chat_private.append_event(t.id,'cancelled','{}');
  ELSIF t.state='running' AND t.lease_expires_at<=clock_timestamp() THEN
   UPDATE public.assistant_chat_turns SET state='uncertain',failure_code='chat_lease_expired' WHERE id=t.id AND state='running' RETURNING * INTO t;
  END IF;
  RETURN jsonb_build_object('turnId',t.id,'attemptId',t.attempt_id,'state',t.state,'cursor',t.cursor,'failureCode',t.failure_code,'recoveryHref','/assistant-activity?workspaceId='||t.workspace_id::text,
   'intentRecoveries',coalesce((SELECT jsonb_agg(jsonb_build_object('intentId',id,'state',state,'originalApprovalId',original_approval_id,'executionState',execution_state,'receiptState',receipt_state,'recoveryHref',recovery_href)) FROM public.assistant_chat_proposal_intents WHERE turn_id=t.id),'[]'));
 END IF;
 IF NOT assistant_chat_private.require_access(t.id,coalesce(p_payload->>'digest',g.digest),p_operation,coalesce(p_payload->>'bodyHash',g.digest)) THEN
  SELECT * INTO t FROM public.assistant_chat_turns WHERE id=t.id;
  RETURN jsonb_build_object('released',false,'turnId',t.id,'state',t.state,'failureCode',coalesce(t.failure_code,'chat_release_unavailable'),'recoveryHref','/assistant-activity?workspaceId='||t.workspace_id::text);
 END IF;
 SELECT * INTO t FROM public.assistant_chat_turns WHERE id=t.id;
 SELECT * INTO g FROM public.assistant_chat_grants WHERE id=t.grant_id;
 IF p_operation='prepare' THEN
  result:=jsonb_build_object('released',true,'canonical',g.canonical,'digest',g.digest,'turnId',t.id);
  PERFORM assistant_chat_private.record_check(t.id,'owner_release',assistant_chat_private.sha(assistant_chat_private.canonical(result))); RETURN result;
 END IF;
 IF p_operation='accept' THEN
  IF p_payload->>'acceptanceRequestId' IS DISTINCT FROM g.acceptance_request_id::text OR p_payload->>'digest' IS DISTINCT FROM g.digest THEN RAISE EXCEPTION 'Acceptance changed' USING ERRCODE='PT409'; END IF;
  IF g.status='prepared' THEN
   IF g.accept_before<=clock_timestamp() THEN RAISE EXCEPTION 'Preview expired' USING ERRCODE='PT409'; END IF;
   UPDATE public.assistant_chat_grants SET status='accepted',accepted_at=clock_timestamp() WHERE id=g.id;
   UPDATE public.assistant_chat_turns SET state='accepted' WHERE id=t.id;
   PERFORM assistant_chat_private.append_event(t.id,'grant_accepted',jsonb_build_object('grantDigest',g.digest,'actor',actor));
  END IF;
  RETURN jsonb_build_object('released',true,'turnId',t.id,'state','accepted');
 END IF;
 IF p_operation='read' THEN
  SELECT * INTO t FROM public.assistant_chat_turns WHERE id=t.id;
  -- Advance only through this page. Empty reads retain the requested boundary;
  -- a later append remains reachable even when the turn is already terminal.
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY sequence),'[]'),coalesce(max(sequence),coalesce((p_payload->>'afterSequence')::bigint,0)) INTO e,n
   FROM (SELECT * FROM public.assistant_chat_events WHERE turn_id=t.id AND sequence>coalesce((p_payload->>'afterSequence')::bigint,0) ORDER BY sequence LIMIT 100) x;
  result:=jsonb_build_object('released',true,'turnId',t.id,'attemptId',t.attempt_id,'state',t.state,'revision',t.revision,'cursor',n,
   'leaseExpiresAt',t.lease_expires_at,'canonical',g.canonical,'digest',g.digest,'modelSteps',t.model_steps,'usageUnknown',t.usage_unknown,
   'reportedOutputTokens',t.reported_output_tokens,'responseBytes',t.response_bytes,
   'events',e,
   'steps',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sequence) FROM public.assistant_chat_steps x WHERE turn_id=t.id),'[]'),
   'calls',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY step_id,call_id) FROM public.assistant_chat_tool_calls x WHERE turn_id=t.id),'[]'),
   'sources',coalesce((SELECT jsonb_agg(envelope ORDER BY id) FROM public.assistant_chat_sources WHERE turn_id=t.id),'[]'),
   'intents',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY event_sequence,id) FROM public.assistant_chat_proposal_intents x WHERE turn_id=t.id),'[]'));
  PERFORM assistant_chat_private.record_check(t.id,'transcript_replay',assistant_chat_private.sha(assistant_chat_private.canonical(result))); RETURN result;
 END IF;
 IF g.status<>'accepted' THEN RAISE EXCEPTION 'Data acceptance required' USING ERRCODE='42501'; END IF;
 -- Prepare already validated its local body. Accept/read need only retained
 -- bytes; decode the immutable grant here only for branches consuming fields.
 b:=assistant_chat_private.lossless(g.canonical::json);
 s:=b->'selection';
 IF p_operation='start' THEN
  IF t.state<>'accepted' THEN RETURN jsonb_build_object('started',false,'state',t.state); END IF;
  UPDATE public.assistant_chat_turns SET state='running',lease_expires_at=least(g.expires_at,clock_timestamp()+make_interval(secs=>((s->>'configurationCanonical')::jsonb->>'timeoutSeconds')::int)) WHERE id=t.id RETURNING * INTO t;
  PERFORM assistant_chat_private.append_event(t.id,'started',jsonb_build_object('attemptId',t.attempt_id,'leaseExpiresAt',to_char(t.lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  RETURN jsonb_build_object('started',true,'leaseExpiresAt',t.lease_expires_at,'attemptId',t.attempt_id);
 END IF;
 IF t.state<>'running' OR t.lease_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('released',false,'state',t.state,'failureCode','chat_not_running'); END IF;
 IF p_operation='progress' THEN
  SELECT * INTO step FROM public.assistant_chat_steps WHERE id=(p_payload->>'stepId')::uuid AND turn_id=t.id FOR UPDATE;
  IF NOT FOUND OR step.state<>'dispatched' OR (p_payload->>'frameSequence')::int NOT BETWEEN 1 AND 4096
   OR NOT assistant_chat_private.is_string(p_payload->'text') OR assistant_chat_private.string_bytes(p_payload->'text')>64000 THEN RAISE EXCEPTION 'Invalid partial progress' USING ERRCODE='22023'; END IF;
  r:=jsonb_build_object('stepId',step.id,'frameSequence',(p_payload->>'frameSequence')::int,'text',p_payload->'text','partial',true);
  SELECT ev.body INTO e FROM public.assistant_chat_events ev WHERE ev.turn_id=t.id AND ev.kind='text_delta' AND ev.body->>'stepId'=step.id::text AND ev.body->>'frameSequence'=p_payload->>'frameSequence';
  IF FOUND THEN IF e IS DISTINCT FROM r THEN RAISE EXCEPTION 'Partial progress conflict' USING ERRCODE='PT409'; END IF; RETURN jsonb_build_object('released',true,'replayed',true); END IF;
  SELECT coalesce(sum(assistant_chat_private.string_bytes(ev.body->'text')),0) INTO n FROM public.assistant_chat_events ev WHERE ev.turn_id=t.id AND ev.kind='text_delta' AND ev.body->>'stepId'=step.id::text;
  IF n+assistant_chat_private.string_bytes(p_payload->'text')>512000 THEN RAISE EXCEPTION 'Partial progress limit' USING ERRCODE='22023'; END IF;
  PERFORM assistant_chat_private.append_event(t.id,'text_delta',r);
  PERFORM assistant_chat_private.record_check(t.id,'owner_release',assistant_chat_private.sha(assistant_chat_private.canonical(r)));
  RETURN jsonb_build_object('released',true);
 END IF;
 IF p_operation='dispatch' THEN
  seq:=(p_payload->>'sequence')::int; body:=p_payload->>'request'; r:=assistant_chat_private.lossless(body::json);
  IF seq<>t.model_steps+1 OR seq NOT BETWEEN 1 AND 6 OR EXISTS(SELECT 1 FROM public.assistant_chat_steps WHERE turn_id=t.id AND state<>'completed')
   OR EXISTS(SELECT 1 FROM public.assistant_chat_tool_calls WHERE turn_id=t.id AND state<>'completed') THEN RAISE EXCEPTION 'Step cannot replay or skip' USING ERRCODE='PT409'; END IF;
  IF octet_length(body)>256000 OR r->>'model' IS DISTINCT FROM s->>'modelId' OR r->>'stream'<>'true' OR r->>'max_tokens'<>'2000'
   OR assistant_chat_private.keys_exact(r,ARRAY['model','messages','stream','max_tokens','stream_options']||CASE WHEN jsonb_array_length(b->'catalog'->'tools')>0 THEN ARRAY['tools','tool_choice'] ELSE ARRAY[]::text[] END) IS NOT TRUE
   OR r->'stream_options' IS DISTINCT FROM '{"include_usage":true}'::jsonb OR (jsonb_array_length(b->'catalog'->'tools')>0 AND r->>'tool_choice' IS DISTINCT FROM 'auto')
   OR assistant_chat_private.normalize_wire_arguments(r->'messages') IS DISTINCT FROM assistant_chat_private.normalize_wire_arguments(assistant_chat_private.expected_messages(t.id))
   OR r->'tools' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('type','function','function',jsonb_build_object('name',d->>'name','description',d->>'description','parameters',d->'inputSchema')) ORDER BY ordinality) FROM jsonb_array_elements((b->'catalog'->>'definitionCanonical')::jsonb) WITH ORDINALITY d(d,ordinality))
   OR r ?| ARRAY['functions','function_call','response_format','n'] THEN RAISE EXCEPTION 'Invalid chat model request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_api_dispatch:'||t.workspace_id::text,0));
  SELECT count(*) INTO recent FROM public.usage_events WHERE workspace_id=t.workspace_id
   AND bucket_key IN ('assistant_chat','grant_narrative_draft','engagement_synthesis','engagement_moderation','document_narrative_draft','rtp_document_extraction')
   AND occurred_at>=clock_timestamp()-interval '300 seconds';
  IF recent>=20 THEN RAISE EXCEPTION 'Staff dispatch reservation refused' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.assistant_chat_steps(id,turn_id,sequence,request_canonical,request_hash,transcript_hash,dependency_hash,state)
   VALUES((p_payload->>'stepId')::uuid,t.id,seq,body,assistant_chat_private.sha(body),assistant_chat_private.sha(assistant_chat_private.canonical(r->'messages')),assistant_chat_private.dependencies(t.id),'dispatched');
  INSERT INTO public.usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)
   VALUES(t.workspace_id,t.id::text,'assistant_chat',1,'assistant_chat_dispatch:'||t.attempt_id::text||':'||seq::text,'/api/assistant/providers/chat',jsonb_build_object('dispatchReservation',true,'step',seq,'provider','api_connection'));
  UPDATE public.assistant_chat_turns SET model_steps=seq WHERE id=t.id;
  PERFORM assistant_chat_private.record_check(t.id,'dispatch',assistant_chat_private.sha(body));
  PERFORM assistant_chat_private.append_event(t.id,'model_dispatch_reserved',jsonb_build_object('stepId',p_payload->>'stepId','sequence',seq,'requestHash',assistant_chat_private.sha(body)));
  RETURN jsonb_build_object('released',true,'stepId',p_payload->>'stepId');
 END IF;
 IF p_operation='finish_step' THEN
  SELECT * INTO step FROM public.assistant_chat_steps WHERE id=(p_payload->>'stepId')::uuid AND turn_id=t.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Step denied' USING ERRCODE='42501'; END IF;
  r:=p_payload->'receipt'; h:=assistant_chat_private.sha(assistant_chat_private.canonical(r));
  IF step.state='completed' THEN IF step.receipt_hash<>h THEN RAISE EXCEPTION 'Terminal changed' USING ERRCODE='PT409'; END IF; RETURN jsonb_build_object('released',true,'replayed',true); END IF;
  IF assistant_chat_private.valid_terminal(r,b) IS NOT TRUE OR step.state<>'dispatched' OR p_payload->>'receiptHash' IS DISTINCT FROM h OR r->>'version'<>'1'
   OR r->>'model' IS DISTINCT FROM s->>'modelId' OR r->>'reason' NOT IN ('stop','tool_calls')
   OR r->>'bodyHash' IS DISTINCT FROM assistant_chat_private.sha(r->>'rawBody') OR octet_length(r->>'rawBody')<>(r->>'responseBytes')::int
   OR (r->>'responseBytes')::int NOT BETWEEN 1 AND 512000 OR t.response_bytes+(r->>'responseBytes')::int>3072000
   OR coalesce((r->>'outputTokens')::int,0) NOT BETWEEN 0 AND 2000 OR t.reported_output_tokens+coalesce((r->>'outputTokens')::int,0)>12000
   OR jsonb_array_length(r->'calls')>12 THEN RAISE EXCEPTION 'Terminal invalid' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.assistant_chat_events ev WHERE ev.turn_id=t.id AND ev.kind='text_delta' AND ev.body->>'stepId'=step.id::text)
   AND r->'text' IS DISTINCT FROM assistant_chat_private.delta_text(t.id,step.id) THEN RAISE EXCEPTION 'Retained deltas differ from terminal' USING ERRCODE='PT409'; END IF;
  UPDATE public.assistant_chat_steps SET state='completed',receipt=r,receipt_hash=h WHERE id=step.id;
  PERFORM assistant_chat_private.record_check(t.id,'finish',h);
  UPDATE public.assistant_chat_turns SET response_bytes=response_bytes+(r->>'responseBytes')::int,
   reported_output_tokens=reported_output_tokens+coalesce((r->>'outputTokens')::int,0),usage_unknown=usage_unknown OR r->>'outputTokens' IS NULL OR r->>'inputTokens' IS NULL WHERE id=t.id;
  FOR c IN SELECT value FROM jsonb_array_elements(r->'calls') LOOP
   IF assistant_chat_private.valid_tool_input(c->>'name',c->'input',b) IS NOT TRUE THEN RAISE EXCEPTION 'Tool input not admitted' USING ERRCODE='42501'; END IF;
   IF NOT (b->'catalog'->'tools') ? (c->>'name') THEN RAISE EXCEPTION 'Tool outside catalog' USING ERRCODE='42501'; END IF;
   IF c->>'name'='get_surface_context' AND (c->'input'->>'kind'<>'project' OR NOT (b->'scope'->'selectedProjectIds') ? (c->'input'->>'id'))
    OR c->>'name'='propose_create_project_record' AND NOT (b->'scope'->'selectedProjectIds') ? (c->'input'->>'projectId') THEN RAISE EXCEPTION 'Tool resource denied' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.assistant_chat_tool_calls WHERE turn_id=t.id AND call_id=c->>'toolCallId') THEN RAISE EXCEPTION 'Duplicate tool call' USING ERRCODE='PT409'; END IF;
   SELECT count(*) INTO n FROM public.assistant_chat_tool_calls WHERE turn_id=t.id;
   IF n>=12 THEN RAISE EXCEPTION 'Tool budget exhausted' USING ERRCODE='PT409'; END IF;
   INSERT INTO public.assistant_chat_tool_calls(turn_id,step_id,call_id,name,input,input_hash,state) VALUES(t.id,step.id,c->>'toolCallId',c->>'name',c->'input',assistant_chat_private.sha(assistant_chat_private.canonical(c->'input')),'reserved');
  END LOOP;
  PERFORM assistant_chat_private.append_event(t.id,'model_terminal',jsonb_build_object('stepId',step.id,'receiptHash',h,'text',r->'text','reason',r->>'reason','inputTokens',r->'inputTokens','outputTokens',r->'outputTokens'));
  IF r->>'reason'='stop' THEN
   IF jsonb_array_length(r->'calls')<>0 THEN RAISE EXCEPTION 'Unexpected tool terminal'; END IF;
   UPDATE public.assistant_chat_turns SET state='succeeded' WHERE id=t.id;
   PERFORM assistant_chat_private.append_event(t.id,'completed',jsonb_build_object('terminalReceiptHash',h,'modelSteps',t.model_steps));
  ELSIF t.model_steps=6 THEN
   UPDATE public.assistant_chat_turns SET state='interrupted',failure_code='chat_model_step_limit' WHERE id=t.id;
   PERFORM assistant_chat_private.append_event(t.id,'interrupted','{"code":"chat_model_step_limit"}');
  END IF;
  RETURN jsonb_build_object('released',true,'receiptHash',h);
 END IF;
 IF p_operation='claim_tool' THEN
  SELECT * INTO call_row FROM public.assistant_chat_tool_calls WHERE id=(p_payload->>'callId')::uuid AND turn_id=t.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tool denied' USING ERRCODE='42501'; END IF;
  IF call_row.state='completed' THEN
   PERFORM assistant_chat_private.record_check(t.id,'provider_tool_result',call_row.result_hash);
   RETURN jsonb_build_object('released',true,'cached',true,'result',call_row.result);
  END IF;
  IF call_row.state<>'reserved' THEN RETURN jsonb_build_object('released',false,'state','uncertain'); END IF;
  UPDATE public.assistant_chat_tool_calls SET state='running' WHERE id=call_row.id;
  SELECT count(*) INTO n FROM public.assistant_chat_tool_calls WHERE turn_id=t.id;
  PERFORM assistant_chat_private.append_event(t.id,'tool_running',jsonb_build_object('callId',call_row.id,'name',call_row.name,'usedCalls',n));
  RETURN jsonb_build_object('released',true,'cached',false,'handle',call_row.handle,'callId',call_row.id,'stepId',call_row.step_id,'toolCallId',call_row.call_id,'name',call_row.name,'input',call_row.input,'usedCalls',n);
 END IF;
 IF p_operation='finish_tool' THEN
  SELECT * INTO call_row FROM public.assistant_chat_tool_calls WHERE id=(p_payload->>'callId')::uuid AND turn_id=t.id FOR UPDATE;
  IF NOT FOUND OR call_row.handle IS DISTINCT FROM (p_payload->>'handle')::uuid THEN RAISE EXCEPTION 'Tool handle denied' USING ERRCODE='42501'; END IF;
  result:=p_payload->'result'; body:=assistant_chat_private.canonical(result); h:=assistant_chat_private.sha(body);
  IF call_row.state='completed' THEN IF call_row.result_hash<>h THEN RAISE EXCEPTION 'Tool retry changed' USING ERRCODE='PT409'; END IF; RETURN jsonb_build_object('released',true,'result',call_row.result); END IF;
  IF call_row.state<>'running' OR octet_length(body)>64000 OR t.tool_bytes+octet_length(body)>768000 THEN RAISE EXCEPTION 'Tool result refused' USING ERRCODE='22023'; END IF;
  IF call_row.name='get_surface_context' AND (assistant_chat_private.keys_exact(result,ARRAY['envelope']) IS NOT TRUE
    OR p_payload->'envelopes' IS DISTINCT FROM jsonb_build_array(result->'envelope') OR result->'envelope'->>'dataClass'<>'selected_project_summary'
    OR assistant_chat_private.lossless((result->'envelope'->>'canonicalProjectedContent')::json)->>'id' IS DISTINCT FROM call_row.input->>'id')
   OR call_row.name='list_projects' AND (assistant_chat_private.keys_exact(result,ARRAY['envelope','returnedCount','possiblyTruncated']) IS NOT TRUE
    OR p_payload->'envelopes' IS DISTINCT FROM jsonb_build_array(result->'envelope') OR result->'envelope'->>'dataClass'<>'workspace_project_index'
    OR result->'returnedCount' IS DISTINCT FROM assistant_chat_private.lossless((result->'envelope'->>'canonicalProjectedContent')::json)->'returnedCount'
    OR result->'possiblyTruncated' IS DISTINCT FROM assistant_chat_private.lossless((result->'envelope'->>'canonicalProjectedContent')::json)->'possiblyTruncated')
   OR call_row.name='propose_create_project_record' AND (assistant_chat_private.keys_exact(result,ARRAY['intentId','executableHash','status','displayConsequence']) IS NOT TRUE
    OR p_payload->'envelopes' IS DISTINCT FROM '[]'::jsonb) THEN RAISE EXCEPTION 'Tool output not admitted' USING ERRCODE='22023'; END IF;
  PERFORM assistant_chat_private.store_sources(t.id,coalesce(p_payload->'envelopes','[]'));
  -- Newly captured contributors enter the union before result release.
  IF NOT assistant_chat_private.require_access(t.id,g.digest,'provider_tool_result',h) THEN RETURN jsonb_build_object('released',false,'state','access_lost'); END IF;
  SELECT * INTO t FROM public.assistant_chat_turns WHERE id=t.id;
  IF call_row.name='propose_create_project_record' THEN
   action:=assistant_chat_private.lossless((p_payload->>'executableCanonical')::json);
   IF action IS DISTINCT FROM (jsonb_build_object('kind','create_project_record','recordType','submittal','projectId',call_row.input->>'projectId',
      'title',assistant_chat_private.trim_string(call_row.input->'title'))
      ||CASE WHEN call_row.input->>'submittalType'<>'other' THEN jsonb_build_object('submittalType',call_row.input->>'submittalType') ELSE '{}'::jsonb END
      ||CASE WHEN assistant_chat_private.trim_string(call_row.input->'notes')<>'""'::jsonb THEN jsonb_build_object('notes',assistant_chat_private.trim_string(call_row.input->'notes')) ELSE '{}'::jsonb END)
    OR coalesce(action->>'submittalType','other') NOT IN ('authorization_packet','invoice_backup','environmental_package','hearing_record','ps_e','reimbursement','progress_report','other')
    OR assistant_chat_private.string_length(action->'title') NOT BETWEEN 1 AND 160 OR assistant_chat_private.string_length(coalesce(action->'notes','""'::jsonb))>4000 THEN RAISE EXCEPTION 'Invalid draft proposal' USING ERRCODE='22023'; END IF;
   h:=assistant_chat_private.sha(p_payload->>'executableCanonical'); iid:=(result->>'intentId')::uuid;
   IF result->>'executableHash'<>h OR result->>'status'<>'proposed' THEN RAISE EXCEPTION 'Proposal hash mismatch'; END IF;
   INSERT INTO public.assistant_chat_proposal_intents(id,owner_user_id,workspace_id,turn_id,attempt_id,grant_id,grant_digest,step_id,tool_call_id,event_sequence,
    executable_canonical,executable_hash,dependency_hash,display_consequence_hash,recovery_href)
   VALUES(iid,actor,t.workspace_id,t.id,t.attempt_id,g.id,g.digest,call_row.step_id,call_row.call_id,t.cursor+1,p_payload->>'executableCanonical',h,
    assistant_chat_private.dependencies(t.id),assistant_chat_private.string_hash(result->'displayConsequence'),'/assistant-activity?workspaceId='||t.workspace_id::text);
  END IF;
  h:=assistant_chat_private.sha(body);
  UPDATE public.assistant_chat_tool_calls SET state='completed',result=result,result_hash=h WHERE id=call_row.id;
  UPDATE public.assistant_chat_turns SET tool_bytes=tool_bytes+octet_length(body) WHERE id=t.id;
  PERFORM assistant_chat_private.record_check(t.id,'provider_tool_result',h);
  PERFORM assistant_chat_private.append_event(t.id,'tool_completed',jsonb_build_object('callId',call_row.id,'name',call_row.name,'resultHash',h,'result',result));
  RETURN jsonb_build_object('released',true,'result',result);
 END IF;
 IF p_operation='interrupt' THEN
  IF coalesce(p_payload->>'state','uncertain') NOT IN ('unavailable','failed','uncertain') OR coalesce(p_payload->>'failureCode','chat_dispatch_or_delivery_uncertain') !~ '^chat_[a-z0-9_]{1,100}$' THEN RAISE EXCEPTION 'Invalid interruption knowledge' USING ERRCODE='22023'; END IF;
  UPDATE public.assistant_chat_steps SET state=CASE WHEN p_payload->>'state'='failed' THEN 'failed' ELSE 'uncertain' END WHERE turn_id=t.id AND state='dispatched';
  UPDATE public.assistant_chat_tool_calls SET state='uncertain' WHERE turn_id=t.id AND state='running';
  UPDATE public.assistant_chat_turns SET state=CASE WHEN t.model_steps=0 THEN 'unavailable' ELSE coalesce(p_payload->>'state','uncertain') END,
   failure_code=coalesce(p_payload->>'failureCode','chat_dispatch_or_delivery_uncertain') WHERE id=t.id RETURNING * INTO t;
  PERFORM assistant_chat_private.append_event(t.id,'interrupted',jsonb_build_object('state',t.state,'failureCode',t.failure_code)); RETURN jsonb_build_object('released',true,'state',t.state);
 END IF;
 RAISE EXCEPTION 'Unsupported chat operation' USING ERRCODE='22023';
END $$;

CREATE FUNCTION assistant_chat_private.intent(p_operation text,p_intent_id uuid,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,assistant_chat_private AS $$
DECLARE actor uuid:=assistant_chat_private.actor(); i public.assistant_chat_proposal_intents; t public.assistant_chat_turns;
 a public.assistant_action_approvals; x public.assistant_action_executions; action jsonb; ctx jsonb; pname text; member_role text; original uuid;
BEGIN
 SELECT * INTO i FROM public.assistant_chat_proposal_intents WHERE id=p_intent_id AND owner_user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intent denied' USING ERRCODE='42501'; END IF;
 IF p_operation='status' THEN
  PERFORM 1 FROM public.assistant_chat_turns WHERE id=i.turn_id FOR UPDATE;
  SELECT * INTO i FROM public.assistant_chat_proposal_intents WHERE id=p_intent_id FOR UPDATE;
  RETURN jsonb_build_object('intentId',i.id,'state',i.state,'executionState',i.execution_state,'receiptState',i.receipt_state,
   'originalApprovalId',i.original_approval_id,'inputHash',i.executable_hash,'approvalExpiresAt',i.approval_expires_at,'revision',i.revision,'recoveryHref',i.recovery_href);
 END IF;
 -- Receipt reconciliation retains the original approval policy. Chat expiry,
 -- current project scope and new-write roles are deliberately not prerequisites.
 IF p_operation='reconcile' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('assistant_chat_source:'||i.workspace_id::text,0));
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=i.workspace_id AND user_id=actor AND lower(trim(role)) IN ('owner','admin','member','viewer');
  IF NOT FOUND THEN RAISE EXCEPTION 'Original workspace denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO t FROM public.assistant_chat_turns WHERE id=i.turn_id FOR UPDATE;
  SELECT * INTO i FROM public.assistant_chat_proposal_intents WHERE id=p_intent_id FOR UPDATE;
  IF i.state='succeeded' THEN RETURN assistant_chat_private.intent('status',i.id,'{}'); END IF;
  IF i.original_approval_id IS NULL THEN RETURN jsonb_build_object('intentId',i.id,'state',i.state,'receiptState','not_checked'); END IF;
  SELECT * INTO a FROM public.assistant_action_approvals WHERE id=i.original_approval_id AND user_id=actor AND workspace_id=i.workspace_id AND input_hash=i.executable_hash AND action_kind='create_project_record';
  IF NOT FOUND THEN RAISE EXCEPTION 'Original approval conflict' USING ERRCODE='PT409'; END IF;
  SELECT * INTO x FROM public.assistant_action_executions WHERE approval_id=a.id AND user_id=actor AND workspace_id=i.workspace_id AND input_hash=i.executable_hash AND action_kind='create_project_record' AND result_receipt IS NOT NULL;
  IF FOUND THEN
   action:=assistant_chat_private.lossless(i.executable_canonical::json);
   IF x.outcome<>'succeeded' OR x.result_receipt->>'recordType'<>'submittal' OR x.result_receipt->'record'->>'project_id' IS DISTINCT FROM action->>'projectId'
    OR x.result_receipt->'record'->>'created_by' IS DISTINCT FROM actor::text OR x.result_receipt->'record'->>'title' IS DISTINCT FROM action->>'title'
    OR x.result_receipt->'record'->>'status' IS DISTINCT FROM coalesce(action->>'status','draft') OR x.result_receipt->'record'->>'submittal_type' IS DISTINCT FROM coalesce(action->>'submittalType','other')
    OR x.result_receipt->'record'->>'notes' IS DISTINCT FROM action->>'notes' THEN
    UPDATE public.assistant_chat_proposal_intents SET state='reconciling',receipt_state='conflict',revision=revision+1 WHERE id=i.id;
   ELSE
    UPDATE public.assistant_chat_proposal_intents SET state='succeeded',execution_state='committed',receipt_state='present_verified',revision=revision+1,
     receipt_identity=jsonb_build_object('approvalId',a.id,'inputHash',a.input_hash,'workspaceId',a.workspace_id,'userId',actor,'submittalId',x.result_receipt->'record'->>'id') WHERE id=i.id;
   END IF;
  ELSIF i.state<>'succeeded' THEN
   UPDATE public.assistant_chat_proposal_intents SET state=CASE WHEN execution_state IN ('requested','uncertain') THEN 'reconciling' ELSE state END,
    execution_state=CASE WHEN execution_state='requested' THEN 'uncertain' ELSE execution_state END,receipt_state='absent_confirmed',revision=revision+1 WHERE id=i.id;
  END IF;
  PERFORM assistant_chat_private.append_event(i.turn_id,'intent_reconciled',jsonb_build_object('intentId',i.id,'originalApprovalId',i.original_approval_id));
  RETURN assistant_chat_private.intent('status',i.id,'{}');
 END IF;
 IF NOT assistant_chat_private.require_access(i.turn_id,coalesce(p_payload->>'expectedGrantDigest',i.grant_digest),'intent_'||p_operation,i.executable_hash) THEN
  RETURN jsonb_build_object('released',false,'intentId',i.id,'state','unavailable','recoveryHref',i.recovery_href);
 END IF;
 SELECT * INTO i FROM public.assistant_chat_proposal_intents WHERE id=p_intent_id FOR UPDATE;
 IF p_operation='read' THEN
  PERFORM assistant_chat_private.record_check(i.turn_id,'owner_release',assistant_chat_private.sha(assistant_chat_private.canonical(jsonb_build_object('released',true,'intent',to_jsonb(i)))));
  RETURN jsonb_build_object('released',true,'intent',to_jsonb(i));
 END IF;
 SELECT role INTO member_role FROM public.workspace_members WHERE workspace_id=i.workspace_id AND user_id=actor;
 action:=assistant_chat_private.lossless(i.executable_canonical::json);
 SELECT name INTO pname FROM public.projects WHERE id=(action->>'projectId')::uuid AND workspace_id=i.workspace_id;
 IF member_role IS NULL OR lower(trim(member_role)) NOT IN ('owner','admin','member') OR NOT FOUND THEN RAISE EXCEPTION 'Current write scope denied' USING ERRCODE='42501'; END IF;
 IF p_operation='issue' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assistant_chat_turns WHERE id=i.turn_id AND state='succeeded') THEN RAISE EXCEPTION 'Partial proposal is not executable' USING ERRCODE='PT409'; END IF;
  IF p_payload->>'expectedExecutableHash' IS DISTINCT FROM i.executable_hash OR p_payload->>'executableCanonical' IS DISTINCT FROM i.executable_canonical
    OR p_payload->>'expectedGrantDigest' IS DISTINCT FROM i.grant_digest THEN RAISE EXCEPTION 'Intent approval differs' USING ERRCODE='PT409'; END IF;
  IF i.original_approval_id IS NOT NULL THEN
   RETURN jsonb_build_object('approvalId',i.original_approval_id,'inputHash',i.executable_hash,'expiresAt',i.approval_expires_at,'replayed',true);
  END IF;
  IF i.state<>'proposed' OR i.execution_state<>'not_requested' OR (p_payload->>'expiresAt')::timestamptz<=clock_timestamp()
    OR (p_payload->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes' OR action->>'kind'<>'create_project_record'
    OR action->>'recordType' IS DISTINCT FROM 'submittal' OR coalesce(action->>'status','draft')<>'draft'
    OR assistant_chat_private.sha(i.executable_canonical)<>i.executable_hash THEN RAISE EXCEPTION 'Intent is not approvable' USING ERRCODE='PT409'; END IF;
  -- Validate action shape at the atomic authority, not solely in the HTTP route.
  IF assistant_chat_private.keys_exact(action,ARRAY['kind','projectId','recordType','title']
      ||CASE WHEN action ? 'submittalType' THEN ARRAY['submittalType'] ELSE ARRAY[]::text[] END
      ||CASE WHEN action ? 'notes' THEN ARRAY['notes'] ELSE ARRAY[]::text[] END) IS NOT TRUE
    OR NOT assistant_chat_private.is_string(action->'title')
    OR assistant_chat_private.string_length(action->'title') NOT BETWEEN 1 AND 160 OR assistant_chat_private.trim_string(action->'title') IS DISTINCT FROM action->'title'
    OR (action ? 'submittalType' AND (jsonb_typeof(action->'submittalType') IS DISTINCT FROM 'string' OR action->>'submittalType' NOT IN ('authorization_packet','invoice_backup','environmental_package','hearing_record','ps_e','reimbursement','progress_report')))
    OR (action ? 'notes' AND (NOT assistant_chat_private.is_string(action->'notes') OR action->'notes'='""'::jsonb OR assistant_chat_private.trim_string(action->'notes') IS DISTINCT FROM action->'notes'))
    OR assistant_chat_private.string_length(coalesce(action->'notes','""'::jsonb))>4000 THEN RAISE EXCEPTION 'Invalid exact draft action' USING ERRCODE='22023'; END IF;
  IF NOT (jsonb_typeof(action->'title')='string' AND (NOT action ? 'notes' OR jsonb_typeof(action->'notes')='string')) THEN
   RAISE EXCEPTION 'chat_action_storage_unavailable' USING ERRCODE='22023'; END IF;
  ctx:=jsonb_build_object('version',1,'action',action,'project',jsonb_build_object('id',action->>'projectId','workspaceId',i.workspace_id,'name',pname));
  IF p_payload->'executionContext' IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Execution context changed' USING ERRCODE='PT409'; END IF;
  original:=(p_payload->>'approvalId')::uuid;
  UPDATE public.assistant_chat_proposal_intents SET state='approval_creating',approval_request_id=(p_payload->>'approvalRequestId')::uuid,revision=revision+1 WHERE id=i.id;
  INSERT INTO public.assistant_action_approvals(id,workspace_id,user_id,action_kind,input_hash,expires_at,execution_context)
   VALUES(original,i.workspace_id,actor,'create_project_record',i.executable_hash,(p_payload->>'expiresAt')::timestamptz,ctx);
  UPDATE public.assistant_chat_proposal_intents SET state='approved',original_approval_id=original,approval_expires_at=(p_payload->>'expiresAt')::timestamptz,approved_by_user_id=actor,revision=revision+1 WHERE id=i.id;
  PERFORM assistant_chat_private.append_event(i.turn_id,'intent_approved',jsonb_build_object('intentId',i.id,'originalApprovalId',original,'inputHash',i.executable_hash,'approvedByUserId',actor));
  RETURN jsonb_build_object('approvalId',original,'inputHash',i.executable_hash,'expiresAt',p_payload->>'expiresAt','replayed',false);
 END IF;
 IF p_operation='claim_execution' THEN
  IF i.original_approval_id IS NULL OR i.original_approval_id::text IS DISTINCT FROM p_payload->>'originalApprovalId' OR i.executable_hash IS DISTINCT FROM p_payload->>'expectedExecutableHash' THEN RAISE EXCEPTION 'Original approval required' USING ERRCODE='42501'; END IF;
  IF i.state<>'approved' OR i.execution_state<>'not_requested' THEN RETURN jsonb_build_object('dispatch',false,'state',i.state); END IF;
  -- This records a request, not approval consumption. Avoid waiting for an
  -- existing approval while holding source locks: the unchanged receipt route
  -- locks approval before source rows. It owns atomic current checks/consumption
  -- and deduplicates independent recovery of this same original approval.
  SELECT * INTO a FROM public.assistant_action_approvals WHERE id=i.original_approval_id AND user_id=actor AND workspace_id=i.workspace_id AND input_hash=i.executable_hash;
  IF NOT FOUND OR a.consumed_at IS NOT NULL OR a.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Approval expired or consumed' USING ERRCODE='42501'; END IF;
  UPDATE public.assistant_chat_proposal_intents SET state='execution_requested',execution_state='requested',revision=revision+1 WHERE id=i.id;
  PERFORM assistant_chat_private.append_event(i.turn_id,'intent_execution_requested',jsonb_build_object('intentId',i.id,'originalApprovalId',a.id));
  RETURN jsonb_build_object('dispatch',true,'approvalId',a.id,'inputHash',a.input_hash);
 END IF;
 IF p_operation='repeat' THEN
  IF p_payload->>'acknowledgePossibleDuplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit repeat confirmation required' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.assistant_action_approvals WHERE id=i.original_approval_id;
  SELECT id INTO original FROM public.assistant_chat_proposal_intents WHERE owner_user_id=actor AND repeat_request_id=(p_payload->>'repeatRequestId')::uuid;
  IF FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM public.assistant_chat_proposal_intents WHERE id=original AND repeat_of_intent_id=i.id) THEN RAISE EXCEPTION 'Repeat request changed' USING ERRCODE='PT409'; END IF;
   RETURN jsonb_build_object('intentId',original);
  END IF;
  original:=gen_random_uuid();
  INSERT INTO public.assistant_chat_proposal_intents(id,owner_user_id,workspace_id,turn_id,attempt_id,grant_id,grant_digest,step_id,tool_call_id,event_sequence,
   executable_canonical,executable_hash,dependency_hash,display_consequence_hash,recovery_href,repeat_of_intent_id,repeat_request_id)
  VALUES(original,actor,i.workspace_id,i.turn_id,i.attempt_id,i.grant_id,i.grant_digest,i.step_id,'repeat_'||original::text,
   i.event_sequence,i.executable_canonical,i.executable_hash,i.dependency_hash,i.display_consequence_hash,i.recovery_href,i.id,(p_payload->>'repeatRequestId')::uuid);
  PERFORM assistant_chat_private.append_event(i.turn_id,'intent_repeat_requested',jsonb_build_object('intentId',original,'repeatOfIntentId',i.id,'priorState',i.state,'priorReceiptState',i.receipt_state));
  RETURN jsonb_build_object('intentId',original);
 END IF;
 RAISE EXCEPTION 'Unsupported intent operation' USING ERRCODE='22023';
END $$;

-- Identity columns and captured bytes cannot be updated through custody code.
CREATE FUNCTION assistant_chat_private.preserve_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old_body jsonb:=to_jsonb(OLD); new_body jsonb:=to_jsonb(NEW); mutable text[];
BEGIN
 mutable:=CASE TG_TABLE_NAME
 WHEN 'assistant_chat_grants' THEN ARRAY['status','accepted_at','revoked_at']
 WHEN 'assistant_chat_turns' THEN ARRAY['state','revision','cursor','lease_expires_at','model_steps','response_bytes','reported_output_tokens','usage_unknown','tool_bytes','failure_code']
 WHEN 'assistant_chat_steps' THEN ARRAY['state','receipt','receipt_hash']
 WHEN 'assistant_chat_tool_calls' THEN ARRAY['state','result','result_hash']
 WHEN 'assistant_chat_proposal_intents' THEN ARRAY['state','approval_request_id','original_approval_id','approval_expires_at','approved_by_user_id','execution_state','receipt_state','receipt_identity','revision']
 ELSE ARRAY[]::text[] END;
 IF (old_body-mutable) IS DISTINCT FROM (new_body-mutable) THEN RAISE EXCEPTION 'Chat identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='assistant_chat_proposal_intents' AND old_body->>'original_approval_id' IS NOT NULL AND old_body->'original_approval_id' IS DISTINCT FROM new_body->'original_approval_id' THEN RAISE EXCEPTION 'Original approval is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='assistant_chat_proposal_intents' AND old_body->>'state'='succeeded' AND (new_body->>'state'<>'succeeded' OR new_body->'receipt_identity' IS DISTINCT FROM old_body->'receipt_identity' OR new_body->>'receipt_state'<>'present_verified') THEN RAISE EXCEPTION 'Verified original result cannot be downgraded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $body$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assistant_chat_grants','assistant_chat_turns','assistant_chat_sources','assistant_chat_steps','assistant_chat_tool_calls','assistant_chat_events','assistant_chat_access_checks','assistant_chat_proposal_intents'] LOOP
  EXECUTE format('CREATE TRIGGER assistant_chat_identity BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION assistant_chat_private.preserve_identity()',t);
 END LOOP;
END $body$;
-- All private helpers are callable only while inside the dedicated role.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA assistant_chat_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA assistant_chat_private TO openplan_chat_authorizer;
CREATE FUNCTION public.assistant_chat_session(p_operation text,p_turn_id uuid,p_payload jsonb DEFAULT '{}') RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,assistant_chat_private AS $$
DECLARE payload jsonb; result jsonb;
BEGIN
 PERFORM assistant_chat_private.actor();
 IF p_payload ? 'canonicalPayload' THEN
  IF assistant_chat_private.keys_exact(p_payload,ARRAY['canonicalPayload']) IS NOT TRUE OR jsonb_typeof(p_payload->'canonicalPayload')<>'string' THEN RAISE EXCEPTION 'Invalid chat payload encoding' USING ERRCODE='22023'; END IF;
  payload:=assistant_chat_private.lossless((p_payload->>'canonicalPayload')::json);
 ELSE payload:=assistant_chat_private.lossless(p_payload::json); END IF;
 result:=assistant_chat_private.session(p_operation,p_turn_id,payload);
 -- Transport canonical text so PostgREST's json_agg(...)->0 cannot decode logical NUL.
 RETURN json_build_object('wireVersion',1,'canonicalResult',assistant_chat_private.canonical(result));
END $$;
CREATE FUNCTION public.assistant_chat_intent(p_operation text,p_intent_id uuid,p_payload jsonb DEFAULT '{}') RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,assistant_chat_private AS $$
DECLARE payload jsonb; result jsonb;
BEGIN
 PERFORM assistant_chat_private.actor();
 IF p_payload ? 'canonicalPayload' THEN
  IF assistant_chat_private.keys_exact(p_payload,ARRAY['canonicalPayload']) IS NOT TRUE OR jsonb_typeof(p_payload->'canonicalPayload')<>'string' THEN RAISE EXCEPTION 'Invalid chat payload encoding' USING ERRCODE='22023'; END IF;
  payload:=assistant_chat_private.lossless((p_payload->>'canonicalPayload')::json);
 ELSE payload:=assistant_chat_private.lossless(p_payload::json); END IF;
 result:=assistant_chat_private.intent(p_operation,p_intent_id,payload);
 -- Transport canonical text so PostgREST's json_agg(...)->0 cannot decode logical NUL.
 RETURN json_build_object('wireVersion',1,'canonicalResult',assistant_chat_private.canonical(result));
END $$;
REVOKE ALL ON FUNCTION public.assistant_chat_session(text,uuid,jsonb),public.assistant_chat_intent(text,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.assistant_chat_session(text,uuid,jsonb),public.assistant_chat_intent(text,uuid,jsonb) TO authenticated;
-- PostgreSQL requires SET membership and schema CREATE for ownership transfer.
-- Grant only during this transaction; the runtime owner keeps neither addition.
GRANT openplan_chat_authorizer TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA public TO openplan_chat_authorizer;
ALTER FUNCTION public.assistant_chat_session(text,uuid,jsonb) OWNER TO openplan_chat_authorizer;
ALTER FUNCTION public.assistant_chat_intent(text,uuid,jsonb) OWNER TO openplan_chat_authorizer;
REVOKE CREATE ON SCHEMA public FROM openplan_chat_authorizer;
REVOKE openplan_chat_authorizer FROM CURRENT_USER;
COMMIT;
