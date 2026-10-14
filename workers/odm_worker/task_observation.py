"""Read supplied task metadata against an original plan without granting writes.

API options are reported metadata, not every effective processing setting. The
caller still owns live authority, engine identity, freshness and transport.
"""
import base64
import copy
import hashlib
import json
import math

from admission_journal import encoded
from draft_custody import original_plan
from engine_effects import RESPONSE_LIMIT
from retained_source import json_bytes

FORMAT = 'openplan.odm-task-observation.v1'
STATES = {10:'queued',20:'running',30:'failed',40:'completed',50:'canceled'}
AUTO_OPTIONS = ('pc-ept','cog','gltf')


def _json(body):
    def pairs(rows):
        result = {}
        for key,value in rows:
            if key in result:raise ValueError('Task metadata repeats a JSON key')
            result[key] = value
        return result
    def constant(value):raise ValueError('Task metadata contains nonfinite JSON')
    try:
        value = json.loads(body.decode('utf-8'),object_pairs_hook=pairs,parse_constant=constant)
        encoded(value,canonical=True)
    except (UnicodeError,RecursionError) as error:
        raise ValueError('Task metadata encoding or depth differs') from error
    return value


def observe(plan, status, body):
    """Retain exact supplied bytes and distinguish reported from proven facts."""
    plan = original_plan(plan)
    if type(status) is not int or status != 200 or type(body) is not bytes or len(body)>RESPONSE_LIMIT:
        raise ValueError('Task metadata response status, type or bound differs')
    value = _json(body)
    if not isinstance(value,dict) or 'error' in value:
        raise ValueError('Task metadata is unavailable or malformed')
    fields = {'uuid','name','dateCreated','processingTime','status','options','imagesCount','progress'}
    if not fields<=set(value):raise ValueError('Task metadata required fields differ')
    if value['uuid'] != plan['taskUuid'] or value['name'] != plan['name']:
        raise ValueError('Task metadata original UUID or name differs')
    count = value['imagesCount']
    if type(count) is not int or count not in (-1,len(plan['uploads'])):
        raise ValueError('Task metadata original image count differs')
    reported = value['options']
    if not isinstance(reported,list) or any(not isinstance(row,dict) or set(row)!={'name','value'}
        or not isinstance(row['name'],str) or not row['name'].strip()
        or type(row['value']) not in (str,int,float,bool) for row in reported):
        raise ValueError('Task metadata reported options shape differs')
    names = [row['name'] for row in reported]
    if len(set(names)) != len(names):raise ValueError('Task metadata reported options repeat a name')
    requested = plan['options'];prefix = reported[:len(requested)]
    if encoded(sorted(prefix,key=lambda row:row['name']),canonical=True) != encoded(sorted(requested,key=lambda row:row['name']),canonical=True):
        raise ValueError('Task metadata original requested options differ')
    additions = reported[len(requested):]
    order = [AUTO_OPTIONS.index(row['name']) if row['name'] in AUTO_OPTIONS else -1 for row in additions]
    if any(row['name'] not in AUTO_OPTIONS or row['value'] is not True for row in additions) or order!=sorted(order):
        raise ValueError('Task metadata automatic option additions differ')
    outcome = value['status']
    if not isinstance(outcome,dict) or set(outcome)-{'code','errorMessage'} or type(outcome.get('code')) is not int or outcome['code'] not in STATES:
        raise ValueError('Task metadata reported state differs')
    detail = outcome.get('errorMessage')
    if detail is not None and (not isinstance(detail,str) or len(detail)>2048):
        raise ValueError('Task metadata reported error detail differs')
    progress = value['progress']
    if type(progress) not in (int,float) or not 0<=progress<=100 or not math.isfinite(progress):
        raise ValueError('Task metadata reported progress differs')
    created = value['dateCreated'];duration = value['processingTime']
    if type(created) is not int or created<0 or type(duration) is not int or duration< -1:
        raise ValueError('Task metadata reported time differs')
    return {'format':FORMAT,'scope':'supplied_api_task_metadata',
        'originalPlanSha256':hashlib.sha256(json_bytes(plan)).hexdigest(),
        'engine':copy.deepcopy(plan['engine']),'taskUuid':plan['taskUuid'],
        'bodyBytes':len(body),'bodySha256':hashlib.sha256(body).hexdigest(),'bodyBase64':base64.b64encode(body).decode(),
        'reportedState':STATES[outcome['code']],'reportedStatusCode':outcome['code'],'reportedErrorDetail':detail,
        'reportedImageCount':count if count>=0 else None,
        'imageCountVerification':'matches_reported_count' if count>=0 else 'unassessed',
        'requestedOptions':copy.deepcopy(requested),'reportedOptions':copy.deepcopy(reported),
        'automaticPostprocessingOptions':copy.deepcopy(additions),
        'reportedProgressPercent':progress,'reportedCreatedAtUnixMs':created,
        'reportedProcessingTimeMs':duration if duration>=0 else None,
        'processingTimeAssessment':'reported' if duration>=0 else 'not_started',
        'engineIdentityVerification':'unassessed','originalActorAuthorization':'unassessed',
        'sourceCustodyVerification':'unassessed','effectiveExecutionSettingsVerification':'unassessed',
        'processingQualityVerification':'unassessed','freshnessVerification':'unassessed',
        'transportPermission':False,'publicationPermission':False}
