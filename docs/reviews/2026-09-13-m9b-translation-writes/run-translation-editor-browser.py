"""Run browser acceptance against installed command grants without changing them."""
import json, os, subprocess
from pathlib import Path
base = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913")
script = Path(__file__).parent / ("translation-access-browser.cjs" if os.environ.get("OPENPLAN_TRANSLATION_ACCESS_PROBE") == "1" else "translation-editor-browser.cjs")
container = "supabase_db_openplan-restore-target-2026091050"
signature = "public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)"
def sql(statement):
    return subprocess.check_output(["docker", "exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], text=True).strip()

def installed_state():
    return json.loads(sql(f"""SELECT jsonb_build_object(
      'count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
      'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
      'command',has_function_privilege('authenticated','{signature}','EXECUTE'),
      'anonymousCommand',has_function_privilege('anon','{signature}','EXECUTE'),
      'directWrites',(SELECT bool_or(has_table_privilege(r,'public.engagement_content_translations',p))
        FROM unnest(ARRAY['authenticated','anon']) r CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p),
      'tableAcl',(SELECT relacl::text FROM pg_class WHERE oid='public.engagement_content_translations'::regclass),
      'commandAcl',(SELECT proacl::text FROM pg_proc WHERE oid='{signature}'::regprocedure));"""))

def main():
    before = installed_state()
    assert before['count'] == 336 and before['latest'] == '20261014000017', 'Expected installed translation migration 17'
    assert before['command'] and not before['anonymousCommand'] and not before['directWrites'], 'Installed translation permissions differ'
    code = None
    try:
        code = subprocess.run(["node", str(script)]).returncode
    finally:
        after = installed_state()
        preserved = after == before
        suffix = 'abrupt-exit' if os.environ.get('OPENPLAN_TRANSLATION_CLEANUP_PROBE') == '1' else 'control' if os.environ.get('OPENPLAN_TRANSLATION_CLEANUP_PROBE') == 'control' else os.environ.get('OPENPLAN_TRANSLATION_LAYOUT_CONTROL', 'journey')
        (base / f'translation-editor-installed-permissions-{"access-" if os.environ.get("OPENPLAN_TRANSLATION_ACCESS_PROBE") == "1" else ""}{suffix}.json').write_text(json.dumps({'childExit': code, 'installedPermissionsPreserved': preserved, 'before': before, 'after': after}))
        assert preserved, 'Browser child changed installed translation permissions or migrations'
        print('Installed translation permissions preserved; child exit', code, flush=True)
    return code

if __name__ == '__main__':
    raise SystemExit(main())
