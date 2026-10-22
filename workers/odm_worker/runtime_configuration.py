"""Bind explicit non-secret operator settings before original worker admission.

Existing retained roots need a separate adoption check. A configuration seal is
local custody, not actor authority, engine attestation or publication approval.
"""
import hashlib
import math
import time
from pathlib import Path

from application_dispatch_http import endpoint
from engine_effects import engine_identity
from retained_source import absolute,json_bytes,publish,reader,writer
from runtime_artifact_access import base_url
from runtime_outcome_recovery import Runtime
from runtime_progress_delivery import parse
from retained_output_archive import clear_unpublished
from url_transport import Transport as AddressPolicy

FORMAT='openplan.odm-operator-configuration.v1'
NAME='operator-configuration.json'
BOUND=64*1024
FIELDS={'format','installationId','targetId','applicationEndpoint','applicationCredentialReference',
        'allowApplicationHttp','engine','sourceRoot','publicBaseUrl','callbackCredentialReference',
        'daemonSocket','daemonUid','bounds','sourcePolicy','callbackPolicy'}
BOUNDS={'sourceMaxBytes','archiveMaxBytes','expandedMaxBytes','archiveMaxEntries',
        'archiveMaxDirectoryBytes','timeoutSeconds','leaseSeconds','pollSeconds'}


def network_policy(value,*,callback=False):
    if not isinstance(value,dict) or set(value)!={'allowedNetworks','allowedPorts','maxRedirects'}:
        raise ValueError('Original operator network policy fields differ')
    if callback and value['maxRedirects']!=0:
        raise ValueError('Original callback policy cannot permit redirects')
    policy=AddressPolicy(allowed_networks=value['allowedNetworks'],allowed_ports=value['allowedPorts'],max_redirects=value['maxRedirects'])
    return {'allowedNetworks':[str(network) for network in policy.networks],
            'allowedPorts':list(policy.ports),'maxRedirects':policy.max_redirects}


def configuration(value):
    if not isinstance(value,dict) or set(value)!=FIELDS or value['format']!=FORMAT:
        raise ValueError('Original operator configuration fields differ')
    for key in ('installationId','targetId','applicationCredentialReference','callbackCredentialReference'):
        if not isinstance(value[key],str) or not value[key].strip() or len(value[key])>256:
            raise ValueError('Original operator configuration references differ')
    endpoint(value['applicationEndpoint'],value['allowApplicationHttp'])
    engine=engine_identity(value['engine']);public=base_url(value['publicBaseUrl'])
    source_policy=network_policy(value['sourcePolicy']);callback_policy=network_policy(value['callbackPolicy'],callback=True)
    source=absolute(value['sourceRoot']);socket=absolute(value['daemonSocket'])
    if type(value['daemonUid']) is not int or value['daemonUid']<0:
        raise ValueError('Original operator daemon owner differs')
    bounds=value['bounds']
    if not isinstance(bounds,dict) or set(bounds)!=BOUNDS:
        raise ValueError('Original operator bounds fields differ')
    for key,item in bounds.items():
        if key.endswith('Seconds'):
            if type(item) not in (int,float) or not math.isfinite(item) or item<=0:
                raise ValueError('Original operator deadlines must be finite and positive')
        elif type(item) is not int or item<=0:
            raise ValueError('Original operator byte and entry limits must be positive integers')
    normalized={**value,'sourcePolicy':source_policy,'callbackPolicy':callback_policy,'engine':engine,'publicBaseUrl':public,'sourceRoot':str(source),'daemonSocket':str(socket)}
    raw=json_bytes(normalized)
    if len(raw)>BOUND:raise ValueError('Original operator configuration exceeds its bound')
    return parse(raw,BOUND)


class Binding:
    def __init__(self,runtime,value,*,timeout=2):
        if not isinstance(runtime,Runtime):raise ValueError('Operator binding needs its original runtime')
        if type(timeout) not in (int,float) or not math.isfinite(timeout) or timeout<=0:
            raise ValueError('Operator binding deadline must be finite and positive')
        if runtime.journal.root!=runtime.root/'admissions':
            raise ValueError('Operator binding admission root differs')
        self._original=(runtime,runtime.root,runtime.journal,runtime.journal.root)
        self.runtime=runtime;self.value=configuration(value);self.timeout=timeout
        if self.value['installationId']!=runtime.installation['installationId']:
            raise ValueError('Operator binding installation differs')
        source=Path(self.value['sourceRoot']);root=runtime.root
        if source==root or source in root.parents or root in source.parents:
            raise ValueError('Operator source and runtime roots must not overlap')
        self.sha256=hashlib.sha256(json_bytes(self.value)).hexdigest()

    def _value(self):
        journal=getattr(self.runtime,'journal',None)
        current=(self.runtime,getattr(self.runtime,'root',None),journal,getattr(journal,'root',None))
        if any(value is not original for value,original in zip(current,self._original)):
            raise ValueError('Operator binding original runtime changed')
        if hashlib.sha256(json_bytes(self.value)).hexdigest()!=self.sha256:
            raise ValueError("Bound operator configuration changed")

    def _read(self):
        self._value()
        with reader(self.runtime.root,NAME) as (stream,info):
            if info.st_size>BOUND:raise ValueError('Saved operator configuration exceeds its bound')
            raw=stream.read(BOUND+1)
            if len(raw)!=info.st_size:raise ValueError('Saved operator configuration length differs')
        saved=configuration(parse(raw,BOUND))
        if raw!=json_bytes(saved) or raw!=json_bytes(self.value):
            raise ValueError('Saved operator configuration differs')
        return saved

    def establish(self):
        """Seal an empty unowned root, or confirm its exact prior settings."""
        if self.runtime._owned:raise ValueError('Operator binding precedes lifetime ownership')
        self._value()
        deadline=time.monotonic()+self.timeout
        with writer(self.runtime.root,deadline):
            self.runtime._check();path=self.runtime.root/NAME
            if path.exists() or path.is_symlink():return self._read()
            with self.runtime.journal.connection() as connection:
                count=connection.execute('SELECT count(*) FROM admissions').fetchone()[0]
                if count:raise ValueError('Original admissions require explicit operator configuration adoption')
                if any(p.name not in ('writer.lock','runtime-installation.json','admissions') and not p.name.startswith('.partial-') for p in self.runtime.root.iterdir()):
                    raise ValueError('Original retained records require explicit operator configuration adoption')
                clear_unpublished(self.runtime.root)
                self._value()
                publish(self.runtime.root,NAME,json_bytes(self.value))
            return self._read()

    def check(self):
        if not self.runtime._owned:raise ValueError('Operator configuration reads require lifetime ownership')
        self._value();self.runtime._check();return self._read()
