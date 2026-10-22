"""Complete private URL bytes with original context, without live authority.

The caller supplies network transport. This library bounds delivered writes;
blocking fetch operations require their own supervised cancellation and deadline.
"""
import copy
import hashlib
import math
import os
from pathlib import Path
import re
import time
import uuid

from admission_journal import private, synchronize
from retained_source import absolute, digest, finite_limit, json_bytes, publish, read_json, reader, writer
from runtime_admission import Runtime
from runtime_preparation import application_context

SEAL = 'openplan.odm-url-source-installation.v1'
PLAN = 'openplan.odm-url-source-plan.v1'
RECEIPT = 'openplan.odm-url-source-receipt.v1'
MANIFEST = 'openplan.odm-url-source-set.v1'


class CountedWriter:
    def __init__(self, output, remaining, check):
        self.output=output;self.remaining=remaining;self.check=check;self.written=0

    def write(self, chunk):
        self.check()
        if not isinstance(chunk, bytes):raise ValueError('URL source write requires bytes')
        if len(chunk)>self.remaining-self.written:raise ValueError('URL source bytes exceed the remaining whole-job limit')
        written=self.output.write(chunk)
        if written!=len(chunk):raise OSError('URL source object write did not finish')
        self.written+=written
        return written


class UrlSources:
    def __init__(self, runtime, root, target_id, fetch, *, max_bytes, timeout=120, cancelled=lambda:False):
        if not isinstance(runtime, Runtime) or not callable(fetch) or not callable(cancelled):
            raise ValueError('Original runtime and explicit URL source adapters are required')
        if not isinstance(target_id,str) or not target_id.strip() or len(target_id)>256:
            raise ValueError('Original URL source target is required')
        if type(timeout) not in (int,float) or not math.isfinite(timeout) or timeout<=0:
            raise ValueError('URL source timeout must be positive and finite')
        finite_limit(max_bytes)
        self.runtime=runtime;self.root=absolute(root);self.target=target_id;self.fetch=fetch
        self.max_bytes=max_bytes;self.timeout=timeout;self.cancelled=cancelled
        if self.root==runtime.root or self.root in runtime.root.parents or runtime.root in self.root.parents:
            raise ValueError('URL source and runtime roots must not overlap')
        try:self.root.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(self.root.parent)
        private(self.root,True)
        self.seal={'format':SEAL,'installationId':runtime.installation['installationId'],
                   'targetId':target_id,'authorityVerification':'unassessed'}
        with writer(self.root,time.monotonic()+timeout):
            saved=self.root/'source-installation.json'
            if not saved.exists() and not saved.is_symlink() and any(p.name!='writer.lock' and not p.name.startswith('.partial-') for p in self.root.iterdir()):
                raise ValueError('URL source records require their original installation seal')
            publish(self.root,saved.name,json_bytes(self.seal))

    def _check(self, deadline):
        if not self.runtime._owned:raise ValueError('URL source intake requires its lifetime runtime owner')
        self.runtime._check()
        if read_json(self.root,'source-installation.json')!=self.seal:raise ValueError('Original URL source installation differs')
        decision=self.cancelled()
        if type(decision) is not bool:raise ValueError('URL source cancellation must return a boolean')
        if decision:raise InterruptedError('Original URL source intake cancelled')
        if time.monotonic()>=deadline:raise TimeoutError('Original URL source deadline exceeded')

    def _plan(self, request_id, application_job, deadline):
        self._check(deadline);entry=self.runtime.journal.get(request_id)
        if entry is None or entry.phase!='started' or not isinstance(entry.started_context,dict) or entry.started_context.get('installationId')!=self.seal['installationId']:
            raise ValueError('Original owned URL source start is required')
        job=copy.deepcopy(application_job)
        context=application_context(entry,self.seal['installationId'],self.target,job)
        imagery=entry.request['imagery'];metadata=imagery['photos'] if imagery['type']=='photo_manifest' else [imagery]
        sources=[]
        for slot,source in enumerate(metadata):
            size=source.get('sizeBytes');checksum=source.get('checksumSha256')
            if size is not None and (type(size) is not int or size<0) or checksum is not None and (not isinstance(checksum,str) or not re.fullmatch('[0-9a-f]{64}',checksum)):
                raise ValueError('Original URL source declarations differ')
            sources.append({'slot':slot,'metadata':copy.deepcopy(source),'declaredBytes':size,'declaredSha256':checksum})
        if sum(row['declaredBytes'] or 0 for row in sources)>self.max_bytes:raise ValueError('Declared URL sources exceed the whole-job limit')
        return {'format':PLAN,'binding':{'originalRequest':copy.deepcopy(entry.request),
            'originalAdmission':copy.deepcopy(entry.admission),'jobReference':entry.job_reference,
            'originalContext':context,'originalApplicationJob':job},'maxBytes':self.max_bytes,'maxAttemptStorageBytes':2*self.max_bytes,'maxAttemptObjects':2*len(sources),'sources':sources}

    def _receipt(self, pack, source, plan_hash, deadline, limit):
        name=f'source-{source["slot"]:05d}.complete.json';path=pack/name
        if not path.exists() and not path.is_symlink():return None
        value=read_json(pack,name);slot=source['slot']
        if not isinstance(value,dict) or set(value)!={'format','planSha256','slot','objectRelativePath','bytes','sha256'} or value['format']!=RECEIPT or value['planSha256']!=plan_hash or type(value['slot']) is not int or value['slot']!=slot or type(value['bytes']) is not int or value['bytes']<0 or not isinstance(value['sha256'],str) or not re.fullmatch('[0-9a-f]{64}',value['sha256']) or not isinstance(value['objectRelativePath'],str) or not re.fullmatch(rf'objects/source-{slot:05d}-[0-9a-f]{{32}}\.bin',value['objectRelativePath']):
            raise ValueError('Original complete URL source receipt differs')
        self._check(deadline)
        actual=digest(pack,value['objectRelativePath'],limit,deadline)
        if actual!={'bytes':value['bytes'],'sha256':value['sha256']}:raise ValueError('Retained complete URL source bytes differ')
        self._declared(source,actual)
        return value

    @staticmethod
    def _declared(source, actual):
        if source['declaredBytes'] is not None and source['declaredBytes']!=actual['bytes'] or source['declaredSha256'] is not None and source['declaredSha256']!=actual['sha256']:
            raise ValueError('URL source bytes differ from original declarations')

    def _download(self, pack, source, plan_hash, remaining, deadline):
        self._check(deadline);slot=source['slot']
        name=f'objects/source-{slot:05d}-{uuid.uuid4().hex}.bin'
        descriptor=os.open(pack/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
        with os.fdopen(descriptor,'wb') as output:
            counted=CountedWriter(output,remaining,lambda:self._check(deadline))
            returned=self.fetch(source['metadata']['url'],counted,remaining,deadline)
            self._check(deadline)
            if type(returned) is not int or returned!=counted.written:raise ValueError('URL source fetch count differs from delivered bytes')
            output.flush();os.fsync(output.fileno())
        synchronize(pack/'objects')
        actual=digest(pack,name,remaining,deadline)
        if actual['bytes']!=counted.written:raise ValueError('URL source stored byte count differs')
        self._declared(source,actual);self._check(deadline)
        receipt={'format':RECEIPT,'planSha256':plan_hash,'slot':slot,'objectRelativePath':name,**actual}
        publish(pack,f'source-{slot:05d}.complete.json',json_bytes(receipt))
        return receipt

    def _storage(self, pack, plan, deadline):
        total=count=0
        for path in (pack/'objects').iterdir():
            self._check(deadline)
            with reader(pack,str(path.relative_to(pack))) as (_stream,info):total+=info.st_size;count+=1
        if total>plan['maxAttemptStorageBytes'] or count>plan['maxAttemptObjects']:
            raise ValueError('URL source attempt storage exceeds its original limit')
        return total,count

    def prepare(self, request_id, application_job):
        """Complete each original source once; retained receipts never refetch."""
        deadline=time.monotonic()+self.timeout;plan=self._plan(request_id,application_job,deadline)
        pack=self.root/('request-'+hashlib.sha256(request_id.encode()).hexdigest())
        try:pack.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(self.root)
        private(pack,True)
        with writer(pack,deadline):
            self._check(deadline);saved=pack/'plan.json'
            if not saved.exists() and not saved.is_symlink() and any(p.name!='writer.lock' and not p.name.startswith('.partial-') for p in pack.iterdir()):
                raise ValueError('URL source records require their original plan')
            publish(pack,'plan.json',json_bytes(plan));plan_hash=hashlib.sha256(json_bytes(plan)).hexdigest()
            objects=pack/'objects'
            try:objects.mkdir(mode=0o700)
            except FileExistsError:pass
            else:synchronize(pack)
            private(objects,True)
            limit=plan['maxBytes'];self._storage(pack,plan,deadline)
            closed=(pack/'completed.json').exists() or (pack/'completed.json').is_symlink()
            receipts=[self._receipt(pack,row,plan_hash,deadline,limit) for row in plan['sources']]
            if closed and any(row is None for row in receipts):raise ValueError('Completed URL sources require every original receipt')
            total=sum(row['bytes'] for row in receipts if row is not None)
            if total>limit:raise ValueError('Retained URL source set exceeds the whole-job limit')
            for index,row in enumerate(plan['sources']):
                if receipts[index] is None:
                    used,count=self._storage(pack,plan,deadline)
                    if count>=plan['maxAttemptObjects']:raise ValueError('URL source attempt count limit reached')
                    remaining=min(limit-total,plan['maxAttemptStorageBytes']-used)
                    receipts[index]=self._download(pack,row,plan_hash,remaining,deadline)
                    total+=receipts[index]['bytes']
            self._check(deadline)
            manifest={'format':MANIFEST,'planSha256':plan_hash,'sources':receipts,'totalBytes':total,
                      'localSourceBytesComplete':True,'authorityVerification':'unassessed','engineTransportPermission':False}
            publish(pack,'completed.json',json_bytes(manifest))
            return {'sourceRoot':pack,'sources':[row['objectRelativePath'] for row in receipts],
                    'manifestSha256':hashlib.sha256(json_bytes(manifest)).hexdigest(),
                    'localSourceBytesComplete':True,'authorityVerification':'unassessed','engineTransportPermission':False}
