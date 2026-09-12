import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const live = LIVE_RLS ? describe : describe.skip;
live("workspace API revision storage", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("API configuration fixtures require an explicit isolated Supabase workdir.");
    }
    container = resolveLocalDbContainer();
  });
  function exercise(body: string) {
    const ids = Object.fromEntries(["owner", "admin", "member", "viewer", "outsider", "workspace", "other", "connection", "otherConnection", "revision", "nextRevision", "otherRevision"].map(key => [key, randomUUID()]));
    const mutationFile = process.env.OPENPLAN_API_CONFIG_MUTATION_SQL;
    if (mutationFile && !isAbsolute(mutationFile)) throw new Error("Mutation SQL must have an explicit local path.");
    const mutation = mutationFile ? readFileSync(mutationFile, "utf8") : "";
    const sql = `BEGIN;
      ${mutation}
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@admin','@admin@example.test'),('@member','@member@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic API workspace','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@admin','admin'),('@workspace','@member','member'),('@workspace','@viewer','viewer'),('@other','@outsider','owner');
      CREATE FUNCTION pg_temp.config() RETURNS text LANGUAGE sql AS $p$
        SELECT '{"label":"Synthetic API","protocol":"openai_chat_completions","endpoint":"https://model.fixture.invalid/v1/","modelIds":["synthetic-model"],"structuredOutput":true,"authMode":"api_key","timeoutSeconds":120}'::text;
      $p$;
      CREATE FUNCTION pg_temp.save(p_user uuid DEFAULT '@owner',p_id uuid DEFAULT '@revision',p_prior uuid DEFAULT NULL,p_config text DEFAULT pg_temp.config(),p_cipher text DEFAULT 'v2:SYNTHETIC-CIPHERTEXT') RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.save_workspace_provider_api_revision(p_user,'@workspace','@connection',p_id,p_prior,p_config,p_cipher);
      $p$;
      ${body}
      SELECT 'API_REVISION_ASSERTIONS_REACHED'; ROLLBACK;`.replace(/@(otherConnection|otherRevision|nextRevision|connection|revision|workspace|outsider|member|viewer|owner|admin|other)/g, (_, key) => ids[key]);
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(output).toContain("API_REVISION_ASSERTIONS_REACHED");
  }

  it("retains immutable revisions, exact save retries and private ciphertext", () => exercise(`
    DO $$ DECLARE first jsonb; second jsonb; again jsonb; BEGIN
      first:=pg_temp.save(); again:=pg_temp.save();
      IF first->>'created'<>'true' OR again->>'created'<>'false' OR first->'revision' IS DISTINCT FROM again->'revision'
        OR first::text LIKE '%SYNTHETIC-CIPHERTEXT%' THEN RAISE EXCEPTION 'Save retry or ciphertext projection failed'; END IF;
      second:=pg_temp.save('@admin','@nextRevision','@revision',replace(pg_temp.config(),'Synthetic API','New label'),'v2:SYNTHETIC-NEW-KEY');
      IF second->'connection'->>'current_revision_id'<>'@nextRevision' OR second->'revision'->>'previous_revision_id'<>'@revision'
        OR (SELECT count(*) FROM public.workspace_provider_api_revisions WHERE connection_id='@connection')<>2 THEN RAISE EXCEPTION 'Revision was overwritten'; END IF;
      again:=pg_temp.save();
      IF again->'revision' IS DISTINCT FROM first->'revision' OR again->'connection'->>'current_revision_id'<>'@nextRevision' THEN RAISE EXCEPTION 'Old save replay changed history'; END IF;
      BEGIN UPDATE public.workspace_provider_api_connections SET current_revision_id='@revision' WHERE id='@connection'; RAISE EXCEPTION 'Current pointer moved backwards'; EXCEPTION WHEN check_violation THEN NULL; END;
      IF (SELECT credential_ciphertext FROM public.workspace_provider_api_credentials WHERE revision_id='@revision')<>'v2:SYNTHETIC-CIPHERTEXT' THEN RAISE EXCEPTION 'Old key was changed'; END IF;
    END $$;`));

  for (const role of ["member", "viewer", "outsider"]) {
    it(`refuses ${role} management despite service RPC access`, () => exercise(`
      DO $$ BEGIN
        BEGIN PERFORM pg_temp.save('@${role}'); RAISE EXCEPTION 'Unauthorized configuration save'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        PERFORM pg_temp.save();
        BEGIN PERFORM public.revoke_workspace_provider_api_connection('@${role}','@workspace','@connection','@revision'); RAISE EXCEPTION 'Unauthorized revocation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      END $$;`));
  }

  it("refuses stale edits, changed retry payloads and revival after revocation", () => exercise(`
    DO $$ DECLARE first jsonb; again jsonb; BEGIN
      PERFORM pg_temp.save();
      BEGIN PERFORM pg_temp.save('@owner','@nextRevision',NULL); RAISE EXCEPTION 'Stale edit accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@owner','@revision',NULL,replace(pg_temp.config(),'Synthetic API','Changed')); RAISE EXCEPTION 'Changed retry config accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@owner','@revision',NULL,pg_temp.config(),'v2:CHANGED'); RAISE EXCEPTION 'Changed retry key accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@owner','@revision','@otherRevision'); RAISE EXCEPTION 'Changed retry predecessor accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@admin'); RAISE EXCEPTION 'Changed retry author accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM public.revoke_workspace_provider_api_connection('@owner','@workspace','@connection','@nextRevision'); RAISE EXCEPTION 'Stale revoke accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      first:=public.revoke_workspace_provider_api_connection('@owner','@workspace','@connection','@revision');
      again:=public.revoke_workspace_provider_api_connection('@owner','@workspace','@connection','@revision');
      IF first IS DISTINCT FROM again OR first->>'revoked_at' IS NULL THEN RAISE EXCEPTION 'Revocation retry changed evidence'; END IF;
      BEGIN PERFORM pg_temp.save('@owner','@nextRevision','@revision'); RAISE EXCEPTION 'Revoked connection edited'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN UPDATE public.workspace_provider_api_connections SET revoked_at=NULL WHERE id='@connection'; RAISE EXCEPTION 'Revoked connection revived'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));

  it("refuses direct revision/key changes and cross-workspace references", () => exercise(`
    SELECT pg_temp.save();
    SELECT public.save_workspace_provider_api_revision('@outsider','@other','@otherConnection','@otherRevision',NULL,pg_temp.config(),'v2:OTHER');
    DO $$ BEGIN
      BEGIN UPDATE public.workspace_provider_api_revisions SET configured_by='@admin' WHERE id='@revision'; RAISE EXCEPTION 'Revision rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.workspace_provider_api_connections SET created_by='@admin' WHERE id='@connection'; RAISE EXCEPTION 'Connection author rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.workspace_provider_api_credentials SET credential_ciphertext='v2:CHANGED' WHERE revision_id='@revision'; RAISE EXCEPTION 'Credential rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.workspace_provider_api_connections SET current_revision_id='@otherRevision' WHERE id='@connection'; RAISE EXCEPTION 'Foreign current revision accepted'; EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@owner','@nextRevision','@otherRevision'); RAISE EXCEPTION 'Foreign prior revision accepted'; EXCEPTION WHEN SQLSTATE 'PT409' OR foreign_key_violation THEN NULL; END;
      BEGIN INSERT INTO public.workspace_provider_api_credentials VALUES('@nextRevision','@connection','@other','v2:FOREIGN'); RAISE EXCEPTION 'Foreign credential reference accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      BEGIN PERFORM public.save_workspace_provider_api_revision('@outsider','@other','@connection','@nextRevision',NULL,pg_temp.config(),'v2:OTHER'); RAISE EXCEPTION 'Foreign connection accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));

  it("reads metadata for members, hides other workspaces and refuses all direct credential access", () => exercise(`
    SELECT pg_temp.save();
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@member',true);
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.workspace_provider_api_connections WHERE id='@connection')<>1 OR
        (SELECT count(*) FROM public.workspace_provider_api_revisions WHERE id='@revision')<>1 THEN RAISE EXCEPTION 'Member metadata unavailable'; END IF;
      BEGIN PERFORM * FROM public.workspace_provider_api_credentials; RAISE EXCEPTION 'Member read credentials'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN UPDATE public.workspace_provider_api_connections SET revoked_at=now() WHERE id='@connection'; RAISE EXCEPTION 'Member wrote configuration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.save_workspace_provider_api_revision('@owner','@workspace','@connection','@nextRevision','@revision',pg_temp.config(),'v2:CHANGED'); RAISE EXCEPTION 'Member impersonated owner RPC'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.workspace_provider_api_connections WHERE id='@connection') OR
        EXISTS(SELECT 1 FROM public.workspace_provider_api_revisions WHERE id='@revision') THEN RAISE EXCEPTION 'Other workspace metadata exposed'; END IF;
    END $$;
    RESET ROLE; DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@member';
    SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','@member',true);
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.workspace_provider_api_revisions WHERE id='@revision') THEN RAISE EXCEPTION 'Removed member retained access'; END IF;
    END $$;
    RESET ROLE; SET LOCAL ROLE anon;
    DO $$ BEGIN
      BEGIN PERFORM * FROM public.workspace_provider_api_connections; RAISE EXCEPTION 'Anonymous configuration access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM * FROM public.workspace_provider_api_credentials; RAISE EXCEPTION 'Anonymous key access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;`));

  it("validates protocol, capabilities, model identities, endpoint and key mode in storage", () => exercise(`
    DO $$ DECLARE bad jsonb; BEGIN
      FOREACH bad IN ARRAY ARRAY['null'::jsonb,'[]'::jsonb,'{}'::jsonb,
        pg_temp.config()::jsonb-'label',jsonb_set(pg_temp.config()::jsonb,'{protocol}','"other"'),
        jsonb_set(pg_temp.config()::jsonb,'{endpoint}','"https://user:secret@host/v1/"'),
        jsonb_set(pg_temp.config()::jsonb,'{endpoint}','"https://host/v1/?secret=value"'),
        jsonb_set(pg_temp.config()::jsonb,'{structuredOutput}','false'),
        jsonb_set(pg_temp.config()::jsonb,'{modelIds}','[]'),jsonb_set(pg_temp.config()::jsonb,'{modelIds}','["same","same"]'),
        jsonb_set(pg_temp.config()::jsonb,'{modelIds}','["with space"]'),jsonb_set(pg_temp.config()::jsonb,'{modelIds}','[null]'),
        jsonb_set(pg_temp.config()::jsonb,'{authMode}','"environment"'),jsonb_set(pg_temp.config()::jsonb,'{timeoutSeconds}','900.1'),
        jsonb_set(pg_temp.config()::jsonb,'{headers}','{"cookie":"private"}',true)] LOOP
        IF public.valid_workspace_provider_api_configuration(bad) THEN RAISE EXCEPTION 'Invalid configuration accepted: %',bad; END IF;
      END LOOP;
      BEGIN PERFORM pg_temp.save('@owner','@revision',NULL,pg_temp.config(),NULL); RAISE EXCEPTION 'Missing key accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM pg_temp.save('@owner','@revision',NULL,replace(pg_temp.config(),'api_key','none')); RAISE EXCEPTION 'Unexpected key accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      PERFORM pg_temp.save('@owner','@revision',NULL,replace(pg_temp.config(),'api_key','none'),NULL);
    END $$;`));
});
