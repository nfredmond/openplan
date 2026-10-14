"""Original supplied settings and URL bytes inside the owned preparation runtime."""
import copy
import hashlib
import math
from pathlib import Path
import re
import time

from admission_journal import encoded, private, synchronize
from retained_source import absolute, digest, json_bytes, publish, read_json, writer
from runtime_admission import Runtime
from runtime_preparation import FIELDS, Preparation
from url_source_custody import MANIFEST as SOURCE_SET, PLAN as SOURCE_PLAN, RECEIPT as SOURCE_RECEIPT, UrlSources

FORMAT = 'openplan.odm-runtime-url-intake.v1'
MAPPING = 'openplan.odm-runtime-url-input-map.v1'
SETTINGS = FIELDS - {'sourceRoot', 'sources'}


class Intake:
    def __init__(self, runtime, source_root, target_id, supply, fetch, *, timeout=120, cancelled=lambda: False):
        if not isinstance(runtime, Runtime) or not callable(supply) or not callable(fetch) or not callable(cancelled):
            raise ValueError('Original runtime URL intake adapters are required')
        if not isinstance(target_id,str) or not target_id.strip() or len(target_id)>256:
            raise ValueError('Original runtime URL intake target is required')
        if type(timeout) not in (int,float) or not math.isfinite(timeout) or timeout<=0:
            raise ValueError('Runtime URL intake timeout must be positive and finite')
        self.runtime=runtime;self.source_root=absolute(source_root);self.target=target_id
        self.supply=supply;self.fetch=fetch;self.timeout=timeout;self.cancelled=cancelled
        if self.source_root==runtime.root or self.source_root in runtime.root.parents or runtime.root in self.source_root.parents:
            raise ValueError('Runtime URL intake roots must not overlap')
        self.validation=Preparation(runtime,lambda entry:None,timeout=timeout)

    def _check(self, request_id, deadline):
        entry=self.validation._entry(request_id)
        decision=self.cancelled()
        if type(decision) is not bool:raise ValueError('Runtime URL intake cancellation must be a boolean')
        if decision:raise InterruptedError('Original runtime URL intake cancelled')
        if time.monotonic()>=deadline:raise TimeoutError('Original runtime URL intake deadline exceeded')
        return entry

    def _settings(self, entry, value):
        if not isinstance(value,dict) or set(value)!=SETTINGS:raise ValueError('Exact original URL preparation settings are required')
        value=copy.deepcopy(value)
        if value['targetId']!=self.target:raise ValueError('Original runtime URL intake target differs')
        count=1 if entry.request['imagery']['type']=='zip_url' else len(entry.request['imagery']['photos'])
        probe={**value,'sourceRoot':self.source_root/('request-'+hashlib.sha256(entry.request['requestId'].encode()).hexdigest()),
               'sources':[f'pending-slot-{slot:05d}' for slot in range(count)]}
        validator=Preparation(self.runtime,lambda entry:probe,timeout=self.timeout)
        spec,context=validator._spec(entry)
        return {key:spec[key] for key in SETTINGS},context

    def _mapping(self, value, plan_hash, entry, settings, context):
        if not isinstance(value,dict) or set(value)!={'format','intakePlanSha256','manifest'} or value['format']!=MAPPING or value['intakePlanSha256']!=plan_hash:
            raise ValueError('Original runtime URL source mapping differs')
        manifest=value['manifest'];metadata=entry.request['imagery'];metadata=metadata['photos'] if metadata['type']=='photo_manifest' else [metadata]
        if not isinstance(manifest,dict) or set(manifest)!={'format','planSha256','sources','totalBytes','localSourceBytesComplete','authorityVerification','engineTransportPermission'} or manifest['format']!=SOURCE_SET or not isinstance(manifest['planSha256'],str) or not re.fullmatch('[0-9a-f]{64}',manifest['planSha256']) or not isinstance(manifest['sources'],list) or len(manifest['sources'])!=len(metadata) or type(manifest['totalBytes']) is not int or not 0<=manifest['totalBytes']<=settings['maxBytes'] or manifest['localSourceBytesComplete'] is not True or manifest['authorityVerification']!='unassessed' or manifest['engineTransportPermission'] is not False:
            raise ValueError('Original runtime URL source manifest differs')
        # Rebuild the source plan from the original settings even when its root
        # is unavailable. A well-formed hash alone cannot identify that plan.
        source_plan={'format':SOURCE_PLAN,'binding':{'originalRequest':entry.request,
            'originalAdmission':entry.admission,'jobReference':entry.job_reference,
            'originalContext':context,'originalApplicationJob':settings['applicationJob']},
            'maxBytes':settings['maxBytes'],'maxAttemptStorageBytes':2*settings['maxBytes'],
            'maxAttemptObjects':2*len(metadata),'sources':[{'slot':slot,'metadata':row,
                'declaredBytes':row.get('sizeBytes'),'declaredSha256':row.get('checksumSha256')}
                for slot,row in enumerate(metadata)]}
        if manifest['planSha256']!=hashlib.sha256(json_bytes(source_plan)).hexdigest():
            raise ValueError('Original mapped URL source plan differs')
        total=0
        for slot,row in enumerate(manifest['sources']):
            if not isinstance(row,dict) or set(row)!={'format','planSha256','slot','objectRelativePath','bytes','sha256'} or row['format']!=SOURCE_RECEIPT or row['planSha256']!=manifest['planSha256'] or type(row['slot']) is not int or row['slot']!=slot or not isinstance(row['objectRelativePath'],str) or not re.fullmatch(rf'objects/source-{slot:05d}-[0-9a-f]{{32}}\.bin',row['objectRelativePath']) or type(row['bytes']) is not int or row['bytes']<0 or not isinstance(row['sha256'],str) or not re.fullmatch('[0-9a-f]{64}',row['sha256']):
                raise ValueError('Original runtime URL source slot differs')
            UrlSources._declared({'declaredBytes':metadata[slot].get('sizeBytes'),'declaredSha256':metadata[slot].get('checksumSha256')},row)
            total+=row['bytes']
        if total!=manifest['totalBytes']:raise ValueError('Original runtime URL source total differs')
        return manifest

    def resume(self, request_id):
        """Use saved original settings; local preparation never grants engine use."""
        deadline=time.monotonic()+self.timeout;entry=self._check(request_id,deadline)
        name=hashlib.sha256(request_id.encode()).hexdigest();root=self.runtime.root/('url-intake-'+name)
        try:root.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(self.runtime.root)
        private(root,True)
        with writer(root,deadline):
            entry=self._check(request_id,deadline);path=root/'plan.json'
            original_plan=path.exists() or path.is_symlink()
            if original_plan:
                saved=read_json(root,path.name)
                if not isinstance(saved,dict) or set(saved)!={'format','binding','settings'} or saved['format']!=FORMAT:
                    raise ValueError('Original runtime URL intake plan differs')
                supplied=saved['settings']
            else:
                prior=[self.source_root/('request-'+name),self.runtime.root/('preparation-'+name)]
                if any(path.name!='writer.lock' and not path.name.startswith('.partial-') for path in root.iterdir()) or any(path.exists() or path.is_symlink() for path in prior):
                    raise ValueError('Runtime URL intake records require their original plan')
                supplied=self.supply(copy.deepcopy(entry))
            settings,context=self._settings(entry,supplied)
            plan={'format':FORMAT,'binding':{'request':entry.request,'admission':entry.admission,'jobReference':entry.job_reference,
                    'originalContext':context},'settings':settings}
            def cancelled():self._check(request_id,deadline);return False
            def fetch(url,output,remaining,given_deadline):
                self._check(request_id,deadline)
                return self.fetch(url,output,remaining,min(deadline,given_deadline))
            map_path=root/'sources.json';prepared_root=self.runtime.root/('preparation-'+name)
            mapped=map_path.exists() or map_path.is_symlink()
            if not mapped:
                if prepared_root.exists() or prepared_root.is_symlink() or (root/'prepared.json').exists() or (root/'prepared.json').is_symlink():
                    raise ValueError('Prepared URL intake requires its original source mapping')
                seal=self.source_root/'source-installation.json'
                if original_plan and not seal.exists() and not seal.is_symlink():
                    raise ValueError('Started URL intake requires its original source installation')
                self._check(request_id,deadline)
                # Create the source installation before saving the settings plan.
                # A saved plan can then never mistake a missing source root for first use.
                source=UrlSources(self.runtime,self.source_root,self.target,fetch,max_bytes=settings['maxBytes'],
                    timeout=max(0,deadline-time.monotonic()),cancelled=cancelled)
            self._check(request_id,deadline);publish(root,'plan.json',json_bytes(plan));self._check(request_id,deadline)
            plan_hash=hashlib.sha256(json_bytes(plan)).hexdigest()
            if mapped:mapping=read_json(root,map_path.name)
            else:
                source.timeout=deadline-time.monotonic();retained=source.prepare(request_id,settings['applicationJob'])
                self._check(request_id,deadline)
                manifest=read_json(retained['sourceRoot'],'completed.json')
                if hashlib.sha256(json_bytes(manifest)).hexdigest()!=retained['manifestSha256']:
                    raise ValueError('Completed URL source manifest hash differs')
                mapping={'format':MAPPING,'intakePlanSha256':plan_hash,'manifest':manifest}
            manifest=self._mapping(mapping,plan_hash,entry,settings,context);publish(root,map_path.name,json_bytes(mapping))
            pack=self.source_root/('request-'+name)
            for row in manifest['sources']:
                self._check(request_id,deadline);local_name=f'objects/source-{row["slot"]:05d}.bin'
                local=prepared_root/'retained'/local_name
                container,relative=(prepared_root/'retained',local_name) if local.exists() or local.is_symlink() else (pack,row['objectRelativePath'])
                actual=digest(container,relative,row['bytes'],deadline)
                if actual!={key:row[key] for key in ('bytes','sha256')}:raise ValueError('Original mapped URL source bytes differ')
            self._check(request_id,deadline)
            spec={**settings,'sourceRoot':pack,'sources':[row['objectRelativePath'] for row in manifest['sources']]}
            prepared=Preparation(self.runtime,lambda entry:spec,timeout=max(0,deadline-time.monotonic())).resume(request_id)
            self._check(request_id,deadline)
            result={'format':FORMAT,'state':'prepared_locally','intakePlanSha256':plan_hash,
                'sourceManifestSha256':hashlib.sha256(json_bytes(manifest)).hexdigest(),'preparation':prepared,'authorityVerification':'unassessed',
                'engineTransportPermission':False}
            publish(root,'prepared.json',json_bytes(result));self._check(request_id,deadline)
            return result

    def __call__(self, job):
        entry=self._check(job['request']['requestId'],time.monotonic()+self.timeout)
        if job['job_reference']!=entry.job_reference or encoded(job['request'],canonical=True)!=encoded(entry.request,canonical=True) or encoded(job['accepted_callback'],canonical=True)!=encoded(entry.admission,canonical=True):
            raise ValueError('Pipeline URL intake identity differs from original admission')
        result=self.resume(entry.request['requestId'])
        job['url_intake']=result;job['preparation']=result['preparation'];job['state']='prepared'
