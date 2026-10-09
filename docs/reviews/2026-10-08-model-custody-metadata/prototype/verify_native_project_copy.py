"""Create, retain, consume and reopen a tiny native project without downloads."""
import hashlib
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
sys.path.insert(0,str(WORKER))
import model_project_inputs as custody
from aequilibrae import Project
from importlib.metadata import version


def inventory(path):
    return {str(p.relative_to(path)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(path.rglob('*')) if p.is_file()}


def main():
    output=Path(os.environ['OPENPLAN_PROJECT_COPY_PROOF_OUTPUT']).absolute()
    output.mkdir(mode=0o700,exist_ok=False)
    source=output/'source'
    project=Project()
    project.new(str(source))
    try:
        with project.db_connection_spatial as connection:
            connection.execute("INSERT INTO nodes(node_id,is_centroid,geometry) VALUES (1,1,GeomFromText('POINT(-121 38)',4326)),(2,1,GeomFromText('POINT(-120.99 38)',4326))")
            connection.execute("INSERT INTO links(link_id,a_node,b_node,direction,modes,link_type,geometry) VALUES (1,1,2,0,'c','default',GeomFromText('LINESTRING(-121 38,-120.99 38)',4326))")
    finally:
        project.close()
    original=inventory(source)
    retained=custody.retain(source,output/'retained')
    consumed=custody.consume(retained,output/'consumer')
    if inventory(source)!=original:
        raise AssertionError('Copy changed source project')
    copied=Path(consumed['package_directory'])
    if inventory(copied)!=original:
        raise AssertionError('Consumer bytes differ before native reopen')
    reader=Project()
    reader.open(str(copied))
    try:
        with reader.db_connection_spatial as connection:
            nodes=connection.execute('SELECT node_id,is_centroid,AsText(geometry) FROM nodes ORDER BY node_id').fetchall()
            links=connection.execute('SELECT link_id,a_node,b_node,modes,AsText(geometry) FROM links ORDER BY link_id').fetchall()
        if nodes!=[(1,1,'POINT(-121 38)'),(2,1,'POINT(-120.99 38)')]:
            raise AssertionError('Native copied nodes differ')
        if links!=[(1,1,2,'c','LINESTRING(-121 38, -120.99 38)')]:
            raise AssertionError('Native copied links differ: '+repr(links))
    finally:
        reader.close()
    if inventory(source)!=original:
        raise AssertionError('Consumer native open changed producer')
    report={'aequilibrae_version':version('aequilibrae'),
            'source_sha256':hashlib.sha256(Path(custody.__file__).read_bytes()).hexdigest(),
            'copied_files':len(original),'native_nodes':nodes,'native_links':links,
            'databases':consumed['database_checks'],'source_unchanged':True,
            'consumer_bytes_equal_before_open':True,
            'limits':'Synthetic two-node one-link project with native spatial records and reopen. No assignment, multi-database transaction, managed registration, interrupted engine closure, normal dispatch or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'result.json').write_text(content)
    (ROOT/'native-project-copy.json').write_text(content)
    print(content)


if __name__=='__main__':main()
