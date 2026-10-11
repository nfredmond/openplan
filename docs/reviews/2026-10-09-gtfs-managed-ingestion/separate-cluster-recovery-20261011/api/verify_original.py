"""Read the preserved source fixture after separate-cluster recovery."""
import hashlib, json, os, sys, time
from pathlib import Path
import run as r

OUT=Path(__file__).parent;ROLE=OUT.parent/'separate-cluster-point-20261011-02'
sys.path.append(str(ROLE))
import run_database as d

def main():
    os.umask(0o077);started=time.monotonic()
    point=OUT.parent/'transit-expanded-local-point-20261011-03'
    container='a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
    database='openplan_recovered_2553c3e83129432e86c97cf3aef72aee'
    d.image.CONTAINER=container;d.image.OUT=OUT
    current=d.image.inventory(database,'original-after-separate-cluster')
    baseline=json.loads((point/'original-before-inventory-private.json').read_text())
    d.image.equal_image(baseline,current)
    protected=point/'source-point-private/configuration-private'
    d.g.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),d.archive.database_properties(container,database))
    census=json.loads((point/'point-file-inventory-private.json').read_text())
    r.files.equal(census,r.files.inventory(point/'source-point-private'))
    d.g.verify_roles(json.loads((protected/'roles-inventory-private.json').read_text()),json.loads(d.archive.role_inventory(container)),(protected/'roles-private.sql').read_text(),d.subprocess.check_output(['docker','exec',container,'pg_dumpall','-U','supabase_admin','--roles-only'],stderr=d.subprocess.PIPE,timeout=60).decode())
    mounted={'id':container}
    d.archive._keys.require_mounted_bytes(mounted,d.archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
    result={'state':'passed-original-preservation-read','wallSeconds':round(time.monotonic()-started,3),'tables':len(current['tables']),'sequences':len(current['sequences']),'originalDatabasePropertiesRolesAndKeyEqual':True,'capturedPointFilesEqual':True,'scope':'Read-only preserved source fixture. Does not inspect every unrelated database or all-host processes.'}
    (OUT/'original-preservation-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)

if __name__=='__main__':main()
