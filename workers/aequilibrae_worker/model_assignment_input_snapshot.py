"""Retain the initial solver's actual class demand before calling execute.

Local file custody only. This does not register scientific preparation, authorize
execution, or cover subsequent calibration assignments.
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import model_record_files


def _digest(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return {'path':path.name,'sha256':digest.hexdigest(),'bytes':path.stat().st_size}


def retain_and_execute(assignment, *, directory, context, profile, network_state, network_settings):
    """Read the configured traffic classes, persist their inputs, then execute.

    A fresh directory is mandatory. An interrupted snapshot is retained and
    cannot be adopted by a second execution.
    """
    classes=list(assignment.classes)
    if [item._id for item in classes]!=['resident','external']:
        raise ValueError('Initial assignment requires resident and external classes')
    records=[]
    expected_index=None
    for item in classes:
        matrix=item.matrix
        index=np.asarray(matrix.index)
        values=np.asarray(matrix.matrix_view)
        if (index.ndim!=1 or index.dtype.kind not in 'iu' or len(index)==0
                or len(np.unique(index))!=len(index)):
            raise ValueError('Assignment centroid identities must be unique integers')
        if expected_index is not None and not np.array_equal(index,expected_index):
            raise ValueError('Assignment class centroid order differs')
        if not np.array_equal(index,np.asarray(item.graph.centroids)):
            raise ValueError('Assignment matrix differs from graph centroid order')
        expected_index=index
        if (list(matrix.view_names)!=[item._id] or values.shape!=(len(index),len(index))
                or values.dtype.kind!='f' or not np.isfinite(values).all() or (values<0).any()):
            raise ValueError('Assignment class demand must be finite nonnegative square values')
        if float(item.pce)!=profile['class_pce']:
            raise ValueError('Assignment class PCE differs from profile')
        records.append((item,index,values))
    actual={'target_gap':assignment.rgap_target,'max_iterations':assignment.max_iter,'cores':assignment.cores}
    if any(actual[key]!=profile[key] for key in actual):
        raise ValueError('Assignment settings differ from profile')
    # Validate all JSON before creating files. Non-finite metadata is not a
    # usable substitute for explicit unavailable evidence.
    metadata=json.loads(json.dumps({'context':context,'profile':profile,
        'network_state':network_state,'network_settings':network_settings},allow_nan=False))
    destination=Path(directory)
    destination.mkdir(mode=0o700,exist_ok=False)
    entries=[]
    for item,index,values in records:
        retained={}
        for role,array in (('centroids',index),('demand',values)):
            path=destination/(item._id+'_'+role+'.npy')
            with path.open('xb') as stream:
                np.save(stream,array,allow_pickle=False)
                stream.flush();os.fsync(stream.fileno())
            # Memory-mapped readback bounds memory use and checks the bytes that
            # reached disk against the active solver view.
            restored=np.load(path,allow_pickle=False,mmap_mode='r')
            try:
                if restored.dtype!=array.dtype or not np.array_equal(restored,array):
                    raise ValueError('Retained assignment array differs from solver input')
            finally:
                restored._mmap.close()
            retained[role]=_digest(path)
        entries.append({'class':item._id,'pce':float(item.pce),'core':list(item.matrix.view_names),**retained})
    manifest={'schema':'openplan.initial-assignment-inputs.v1',**metadata,'classes':entries,
        'scope':'initial_assignment_only','scientific_acceptance':'unassessed',
        'preparation_independence':'unassessed','publication_state':'retained_locally'}
    content=json.dumps(manifest,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    model_record_files.materialize(destination,{'manifest.json':content})
    for folder in (destination,destination.parent):
        descriptor=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
    receipt={'manifest_path':str(destination/'manifest.json'),**{key:value for key,value in _digest(destination/'manifest.json').items() if key!='path'},'scope':'initial_assignment_only'}
    assignment.execute()
    return receipt
