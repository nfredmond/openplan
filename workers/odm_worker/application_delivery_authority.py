"""Observe current access for original delivery without broadening processing."""
import copy
from datetime import datetime
import json
import re
import time

from retained_task_observation import finite_number
from runtime_dispatch_custody import Custody, strict_object

FORMAT='openplan.odm-delivery-authority.v1'
ARTIFACT='original_application_artifact_download'
TERMINAL='original_application_terminal_delivery'
FIELDS={'format','installationId','targetId','operation','applicationJob','payloadSha256',
    'authorizedNow','authorityObservedAt','engineTransportPermission'}
REPLY_LIMIT=64*1024


class Authority:
    def __init__(self,dispatch,transport,*,timeout=10):
        if not isinstance(dispatch,Custody) or not callable(transport):
            raise ValueError('Delivery authority needs original custody and explicit transport')
        if not finite_number(timeout) or timeout<=0:
            raise ValueError('Delivery authority deadline must be finite and positive')
        self.dispatch=dispatch;self.transport=transport;self.timeout=min(timeout,dispatch.timeout)

    def __call__(self,binding,operation,deadline,*,owned,callback=None):
        """Compare the saved original before reading this operation's current access."""
        if not finite_number(deadline) or not callable(owned):
            raise ValueError('Delivery authority requires shared deadline and ownership')
        deadline=min(deadline,time.monotonic()+self.timeout)
        if not isinstance(binding,dict) or not isinstance(binding.get('requestId'),str):
            raise ValueError('Delivery authority requires its original binding')
        request_id=binding['requestId']
        def check():
            if owned() is not True:
                raise InterruptedError('Delivery authority ownership ended')
            return self.dispatch._check(request_id,deadline)
        entry=check();original=self.dispatch.load(request_id,deadline=deadline)
        expected={'installationId':self.dispatch.runtime.installation['installationId'],
            'targetId':self.dispatch.target,'requestId':request_id,'jobReference':entry.job_reference,
            'originalApplicationJob':original['applicationJob'],
            'originalDispatchSha256':original['payloadSha256']}
        if any(binding.get(key)!=value for key,value in expected.items()):
            raise ValueError('Delivery authority supplied original differs')
        if operation not in (ARTIFACT,TERMINAL) or (operation==ARTIFACT and callback is not None) or (operation==TERMINAL and not isinstance(callback,dict)):
            raise ValueError('Delivery authority operation or callback scope differs')
        if operation==TERMINAL and (callback.get('requestId')!=request_id or callback.get('jobReference')!=entry.job_reference
                or callback.get('schemaVersion')!=entry.request['schemaVersion'] or callback.get('status') not in ('succeeded','failed','canceled')):
            raise ValueError('Delivery authority terminal original differs')
        arguments={'p_request':request_id,'p_installation':expected['installationId'],
            'p_target':expected['targetId'],'p_reference':expected['jobReference'],'p_operation':operation,'p_callback':copy.deepcopy(callback)}
        check();raw=self.transport(arguments,deadline,owned=owned);check()
        if type(raw) is not bytes or not 0<len(raw)<=REPLY_LIMIT:
            raise ValueError('Delivery authority response byte count differs')
        try:
            value=json.loads(raw.decode('utf-8'),object_pairs_hook=strict_object,
                parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite delivery JSON')))
        except (ValueError,UnicodeError,RecursionError):
            raise ValueError('Delivery authority response JSON differs') from None
        if (not isinstance(value,dict) or set(value)!=FIELDS or value['format']!=FORMAT
                or value['installationId']!=expected['installationId'] or value['targetId']!=expected['targetId']
                or value['operation']!=operation or value['applicationJob']!=expected['originalApplicationJob']
                or value['payloadSha256']!=expected['originalDispatchSha256']
                or type(value['authorizedNow']) is not bool or value['engineTransportPermission'] is not False):
            raise ValueError('Delivery authority response original scope differs')
        observed=value['authorityObservedAt']
        if not isinstance(observed,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})',observed):
            raise ValueError('Delivery authority observation time differs')
        try:datetime.fromisoformat(observed.replace('Z','+00:00'))
        except ValueError:raise ValueError('Delivery authority observation time differs') from None
        check()
        return value['authorizedNow']
