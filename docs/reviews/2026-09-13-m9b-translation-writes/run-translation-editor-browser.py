"""Contain the temporary command grant even when the browser child exits abruptly."""
import json, os, subprocess
from pathlib import Path
base = Path("/home/nathaniel/.local/state/openplan/response-write-probe-20260913")
script = Path(__file__).parent / "translation-editor-browser.cjs"
container = "supabase_db_openplan-restore-target-2026091050"
signature = "public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)"
def sql(statement):
    return subprocess.check_output(["docker", "exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], text=True).strip()
assert sql(f"select has_function_privilege('authenticated','{signature}','EXECUTE')") == 'f'
code = None
try:
    sql(f"GRANT EXECUTE ON FUNCTION {signature} TO authenticated")
    code = subprocess.run(["node", str(script)]).returncode
finally:
    sql(f"REVOKE EXECUTE ON FUNCTION {signature} FROM authenticated")
    revoked = sql(f"select has_function_privilege('authenticated','{signature}','EXECUTE')") == 'f'
    assert revoked
    suffix = 'abrupt-exit' if os.environ.get('OPENPLAN_TRANSLATION_CLEANUP_PROBE') == '1' else 'control' if os.environ.get('OPENPLAN_TRANSLATION_CLEANUP_PROBE') == 'control' else os.environ.get('OPENPLAN_TRANSLATION_LAYOUT_CONTROL', 'journey')
    (base / f'translation-editor-cleanup-{suffix}.json').write_text(json.dumps({'childExit': code, 'grantRevoked': revoked}))
    print('Temporary command grant revoked; child exit', code, flush=True)
raise SystemExit(code)
