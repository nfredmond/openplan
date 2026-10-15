"""Feed source-derived health JSON to the real attestor with all I/O replaced."""
import json
import os
from pathlib import Path
import subprocess
import sys
import types

PUBLIC=Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-app-binding'
REPO=PUBLIC.parents[2]
ORIGINAL=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
PRIVATE=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')

def main():
    os.umask(0o077)
    trial=sys.argv[1] if len(sys.argv)>1 else '01'
    source=(PUBLIC/'verify_attestation.py').read_text().split('\nbaseline=campaign(BASE)\n')[0]
    source=source.replace(str(ORIGINAL),str(PRIVATE))
    old="text=(PUBLIC/'verify_controls.py').read_text().split('\\nrows=campaign(m)\\n')[0]"
    assert source.count(old)==1
    source=source.replace(old,old+'.replace('+repr(str(ORIGINAL))+','+repr(str(PRIVATE))+')')
    source=source.replace("text=text.replace('fixtures-05','attest-fixtures-01')",
                          "text=text.replace('fixtures-05','independent-health-fixtures-"+trial+"')")
    fixture=types.ModuleType('health_fixture');fixture.__file__=str(PUBLIC/'verify_attestation.py')
    exec(compile(source,fixture.__file__,'exec'),vars(fixture))
    a=fixture.a;h=fixture.h
    route=(REPO/'openplan/src/app/api/health/route.ts').read_text()
    safe=route.split('function safeCommitSha(',1)[1].split('\n/**',1)[0]
    safe='function safeCommitSha('+safe
    assert safe.count('value: string | null | undefined')==1
    safe=safe.replace('value: string | null | undefined','value')
    payload='function healthPayload()'+route.split('function healthPayload()',1)[1].split('\nexport function GET()',1)[0]
    migrations=sorted((REPO/'openplan/supabase/migrations').glob('*.sql'))
    js='const APP_VERSION="probe"; const appCommitSha=()=>'+json.dumps(a.APP_HEAD)+';\n'
    js+='const expectedMigrations=()=>('+json.dumps({'count':len(migrations),'latest':migrations[-1].name.split('_')[0]})+');\n'
    js+=safe+payload+'\nprocess.stdout.write(JSON.stringify(healthPayload()));\n'
    result=subprocess.run(['/usr/bin/node','-e',js],capture_output=True,env={'PATH':'/usr/bin:/bin'},check=True,timeout=10)
    real_payload=json.loads(result.stdout)
    assert real_payload['deployment']['commit']==a.APP_HEAD[:12]
    # The imported health identity dependencies are explicit stubs. Formatter
    # and payload function bodies are current application source, unchanged.
    rows=[]
    def attempt(label,source,health,reason):
        h.build_setup(a);h.run_consumer(a,'build');h.run_consumer(a,'start');fixture.state.clear()
        fixture.state['health']=health
        (h.FIX/'attest_start_v1.py').write_bytes(source);h.refresh_binding(a)
        try:fixture.invoke(fixture.load(source))
        except ValueError as e:
            assert str(e)==reason,(label,str(e))
            rows.append({'case':label,'outcome':'refused','reason':str(e)})
        else:
            assert reason is None,label+':accepted-broken-behavior'
            rows.append({'case':label,'outcome':'survived'})
    base=fixture.BASE
    try:
        attempt('synthetic full SHA control',base,{},None)
        attempt('harmless comment retains synthetic success',base+b'\n# No behavior change.\n',{},None)
        attempt('actual route payload rejects correct app',base,real_payload,'attest-http-identity')
        # A proposed correction exists only in a private in-memory test copy.
        fixed=base.replace(b"health['deployment']['commit']==a.APP_HEAD",b"health['deployment']['commit']==a.APP_HEAD[:12]")
        assert fixed!=base
        attempt('fixture-only prefix correction accepts actual payload',fixed,real_payload,None)
        wrong=json.loads(json.dumps(real_payload));wrong['deployment']['commit']=a.HELPER_HEAD[:12]
        attempt('fixture-only correction refuses wrong commit',fixed,wrong,'attest-http-identity')
    finally:
        (h.FIX/'attest_start_v1.py').write_bytes(base);h.refresh_binding(a)
    attempt('restored source again rejects actual payload',base,real_payload,'attest-http-identity')
    with (PRIVATE/('health-probe-'+trial+'.json')).open('x') as f:
        json.dump({'routeSha256':a.sha(REPO/'openplan/src/app/api/health/route.ts'),
                   'sourcePayload':real_payload,'rows':rows,'restored':True,
                   'blindCategory':'Imported commit/migration functions are explicit inputs. No Next route, web process or HTTP request runs.'},f,indent=2);f.write('\n')
    print(json.dumps({'observations':len(rows),'finding':'P2 health commit length mismatch','restored':True}))

if __name__=='__main__':main()
