"""Parent-side registration of a child's fixed initial assignment snapshot."""
import hashlib
import json
import os
from pathlib import Path
import stat


def _file(path, *, capture=False):
    if path.resolve(strict=True)!=path:
        raise ValueError('Assignment snapshot path contains an alias')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or (capture and before.st_size>16*1024*1024):
            raise ValueError('Assignment snapshot file type or size is invalid')
        digest=hashlib.sha256();parts=[];size=0
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            size+=len(chunk);digest.update(chunk)
            if size>before.st_size:raise ValueError('Assignment snapshot grew during verification')
            if capture:parts.append(chunk)
        after=os.fstat(stream.fileno())
    current=path.stat(follow_symlinks=False)
    identity=lambda value:tuple(getattr(value,key) for key in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'))
    if size!=before.st_size or identity(before)!=identity(after) or identity(after)!=identity(current):
        raise ValueError('Assignment snapshot changed during verification')
    return {'path':path.name,'sha256':digest.hexdigest(),'bytes':size},b''.join(parts)


def register(writer, output_directory):
    """Use parent-owned scope and current stage identity, then the artifact fence."""
    writer.require_open()
    try:
        if writer.files is None:raise ValueError('Assignment snapshot requires owned files')
        writer.files.verify()
        output=Path(output_directory)
        if output.parent!=writer.files.path or output.resolve(strict=True)!=output:
            raise ValueError('Assignment snapshot output differs from owned attempt')
        path=output/'initial_assignment_inputs'/'manifest.json'
        record,content=_file(path,capture=True)
        from model_engine_channel import _unique
        manifest=json.loads(content,object_pairs_hook=_unique,parse_constant=lambda value:(_ for _ in ()).throw(ValueError('Nonfinite snapshot metadata')))
        context=manifest.get('context',{})
        method=context.get('demand_method')
        stages={'aequilibrae':'Network Assignment','activitysim':'ActivitySim Network Assignment'}
        if (manifest.get('schema')!='openplan.initial-assignment-inputs.v1'
                or manifest.get('scope')!='initial_assignment_only'
                or manifest.get('scientific_acceptance')!='unassessed'
                or manifest.get('preparation_independence')!='unassessed'
                or manifest.get('publication_state')!='retained_locally'
                or context!={'run_id':writer.context.run_id,'stage_id':writer.context.stage_id,'demand_method':method}
                or method not in stages):
            raise ValueError('Assignment snapshot scope or claim differs')
        writer._read_state(expected_stage_name=stages[method])
        classes=manifest.get('classes')
        if not isinstance(classes,list) or [entry.get('class') for entry in classes]!=['resident','external']:
            raise ValueError('Assignment snapshot classes differ')
        for entry in classes:
            for role in ('centroids','demand'):
                expected=entry.get(role)
                name=entry['class']+'_'+role+'.npy'
                if not isinstance(expected,dict) or expected.get('path')!=name:
                    raise ValueError('Assignment snapshot array name differs')
                actual,_=_file(path.parent/name)
                if actual!=expected:raise ValueError('Assignment snapshot array bytes differ')
        from model_assignment_preparation_link import retained_preparation
        preparation_link=retained_preparation(writer,method)
        writer.files.verify()
        writer.record_artifact({'run_id':writer.context.run_id,'stage_id':writer.context.stage_id,
            'artifact_type':'model_initial_assignment_inputs','file_url':'local://'+str(path),
            'content_hash':record['sha256'],'file_size_bytes':record['bytes'],
            'metadata_json':{'schema':manifest['schema'],'demand_method':method,'scope':'initial_assignment_only',
                             'scientific_acceptance':'unassessed','preparation_independence':'unassessed',
                             'preparation_link':preparation_link}},
            logical_name='initial-assignment-inputs')
        return {'manifest_path':str(path),'sha256':record['sha256'],'bytes':record['bytes'],'scope':'initial_assignment_only'}
    except BaseException:
        writer.stopped=True
        raise
