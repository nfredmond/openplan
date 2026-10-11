"""Start only frozen bf1 against the successful expanded restored target."""
import hashlib,json,os,socket,subprocess
from pathlib import Path
import scope as s,services
OUT=Path(__file__).parent;REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011');BUILD='W4maaz9jts1wco0KXcWbA'
def prepare(cwd,head,dirty,build,plan,result,configuration,values,occupied):
    s.require(cwd==REPO/'openplan' and head==s.HEAD and not dirty,'expanded-preview-source')
    s.require(build==BUILD,'expanded-preview-build')
    s.require(result['state']=='passed-native' and result['sourceHead']==s.HEAD,'expanded-preview-native')
    s.require(configuration['database']==plan['targetDatabase']==result['targetDatabase'],'expanded-preview-target')
    s.require(configuration['api_url']==s.API and values['NEXT_PUBLIC_SUPABASE_URL']==s.API,'expanded-preview-api')
    s.require(not occupied,'expanded-preview-port')
    settings=dict(values)
    for key in ('OPENPLAN_COMMIT_SHA','NEXT_PUBLIC_OPENPLAN_COMMIT_SHA','VERCEL_GIT_COMMIT_SHA','OPENPLAN_GTFS_PARSER_BUILD'):settings[key]=s.HEAD
    settings['NODE_OPTIONS']='--max-old-space-size=768'
    return settings

def main():
    os.umask(0o077);plan=json.loads((OUT/'plan.json').read_text());result=json.loads((OUT/'result.json').read_text());configuration=json.loads((OUT/'target-service-receipts-private.json').read_text());APP=REPO/'openplan';bundle=OUT/'source-point-private';restored=OUT/'target-restored-private'/bundle.relative_to('/')
    values={k:json.loads(v) for k,v in (line.split('=',1) for line in (restored/'configuration-private/app-runtime-private.env').read_text().splitlines())}
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=APP,text=True).strip();dirty=subprocess.check_output(['git','status','--porcelain'],cwd=APP,text=True).strip();build=(APP/'.next/BUILD_ID').read_text().strip()
    with socket.socket() as sock:sock.settimeout(1);occupied=sock.connect_ex(('127.74.9.10',3568))==0
    settings=prepare(Path.cwd(),head,dirty,build,plan,result,configuration,values,occupied)
    for kind,receipt in configuration['services'].items():
        info=services.inspect(receipt['id']);services.verify_new(kind,info,receipt,plan['targetDatabase'],restored/'storage-objects',OUT/'target-kong-runtime-private.json');s.require(info['State']['Running'],'expanded-preview-service-inactive')
    settings['OPENPLAN_GTFS_WORK_DIR']=str(restored/'gtfs-configured')
    (OUT/'preview-start.json').write_text(json.dumps({'head':head,'buildId':build,'database':plan['targetDatabase'],'cwd':str(APP),'runtimeUrl':'http://127.74.9.10:3568','workerRootMapping':'Restored configured root, separately retained from replacement and capacity roots','unit':'openplan-gtfs-expanded-preview-20261011-03.service'},indent=2)+'\n')
    os.execve('/usr/bin/npm',['npm','run','start','--','--hostname','127.74.9.10','--port','3568'],{**os.environ,**settings})
if __name__=='__main__':main()
