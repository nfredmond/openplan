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
import model_attempt_writer as managed
from test_project_working_copy import ProjectWorkingCopyTests
from test_model_skip_dispatch import aeq


def inventory(path):
    return {str(p.relative_to(path)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(path.rglob('*')) if p.is_file()}


def main():
    output=Path(os.environ['OPENPLAN_PROJECT_COPY_PROOF_OUTPUT']).absolute()
    output.mkdir(mode=0o700,exist_ok=False)
    fixture=ProjectWorkingCopyTests()
    fixture.setUp()
    writer=fixture.writer
    root=writer.workspace(output/'runs',writer.context.run_id)
    source=root/'source'
    project=Project()
    project.new(str(source))
    try:
        with project.db_connection_spatial as connection:
            connection.execute("INSERT INTO nodes(node_id,is_centroid,geometry) VALUES (1,1,GeomFromText('POINT(-121 38)',4326)),(2,1,GeomFromText('POINT(-120.99 38)',4326))")
            connection.execute("INSERT INTO links(link_id,a_node,b_node,direction,modes,link_type,geometry) VALUES (1,1,2,0,'c','default',GeomFromText('LINESTRING(-121 38,-120.99 38)',4326))")
    finally:
        project.close()
    original=inventory(source)
    consumed=custody.retain(source,root/'predecessor_project')
    consumed['producer']={'artifact_id':fixture.artifact['id'],'stage_id':fixture.artifact['stage_id'],'attempt_id':fixture.artifact['attempt_id'],'manifest_sha256':consumed['manifest_sha256']}
    retained_before=inventory(Path(consumed['package_directory']))
    working=writer.prepare_project_working_copy(consumed)
    if inventory(source)!=original:
        raise AssertionError('Copy changed source project')
    with managed.bind(writer):
        copied=Path(aeq.project_work_directory(str(root)))
    if str(copied)!=working['project_directory'] or copied==Path(consumed['package_directory']):
        raise AssertionError('Resolver did not select independent working copy')
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
    if inventory(source)!=original or inventory(Path(consumed['package_directory']))!=retained_before:
        raise AssertionError('Native working open changed retained input or producer')
    report={'aequilibrae_version':version('aequilibrae'),
            'writer_sha256':hashlib.sha256(Path(managed.__file__).read_bytes()).hexdigest(),
            'worker_sha256':hashlib.sha256(Path(aeq.__file__).read_bytes()).hexdigest(),
            'copied_files':len(original),'native_nodes':nodes,'native_links':links,
            'databases':consumed['database_checks'],'source_unchanged':True,
            'working_bytes_equal_before_open':True,'retained_input_unchanged':True,'resolver_selected_working_copy':True,
            'limits':'Synthetic native two-node one-link project opened through actual writer preparation and managed resolver. Registration uses mocked transport; consumed inventory fixture is created directly. No assignment, native registration in this proof, interrupted closure, normal dispatch or scientific acceptance.'}
    content=json.dumps(report,indent=2)+'\n'
    (output/'result.json').write_text(content)
    (ROOT/'native-project-working.json').write_text(content)
    print(content)
    fixture.doCleanups()


if __name__=='__main__':main()
