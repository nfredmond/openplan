import http.server, json, os, subprocess, threading
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/write-outcome-truth-2026-09-10')
os.chdir(root/'openplan')
state={'commit':'unknown'}
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers(); self.wfile.write(json.dumps({'deployment':{'commit':state['commit'],'version':'synthetic'}} ,separators=(',',':')).encode())
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'
script=root/'openplan/scripts/ops/which-openplan.sh'
original=script.read_text(); results=[]
def run(name,expected):
 r=subprocess.run(['bash',str(script),url],capture_output=True,text=True)
 Path(__file__).with_name(name+'.log').write_text(r.stdout+r.stderr)
 assert r.returncode==expected,(name,r.stdout)
 results.append({'name':name,'exitCode':r.returncode})
try:
 run('unstamped-listener-refused',1)
 state['commit']=subprocess.check_output(['git','rev-parse','--short=12','HEAD'],text=True).strip()
 run('stamped-listener-control',0)
 state['commit']='unknown'
 script.write_text(original+'\n# Harmless identity comment.\n');run('identity-harmless-comment',1)
 script.write_text(original.replace(' && [ "$NEXT_DEV" = "True" ]',''));run('identity-unsafe-mutation-exposed',0)
finally:
 script.write_text(original);server.shutdown();server.server_close()
Path(__file__).with_name('identity-live.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results))
