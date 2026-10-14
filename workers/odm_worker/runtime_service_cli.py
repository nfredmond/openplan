"""Explicit installation entry point for the sealed original-worker service.

This command reads private local files. It never selects environment defaults,
changes the legacy worker command or adopts an unsealed retained root.
"""
import argparse
import copy
import math
import signal
import sys

from admission_journal import private
from application_dispatch_http import credentials as application_credentials
import contract
from retained_source import absolute, json_bytes, reader
from runtime_configuration import configuration
from runtime_service import Service

LIMIT=64*1024


def document(path):
    path=absolute(path);private(path.parent,True)
    with reader(path.parent,path.name) as (stream,info):
        if info.st_size>LIMIT:raise ValueError('Operator input exceeds its bound')
        raw=stream.read(LIMIT+1)
    import json
    value=json.loads(raw)
    if len(raw)!=info.st_size or raw!=json_bytes(value):
        raise ValueError('Operator input must be complete canonical JSON')
    return value


def token(value,optional=False):
    if value is None and optional:return None
    if (not isinstance(value,str) or not 1<=len(value)<=8192
            or any(ord(char)<33 or ord(char)>126 for char in value)):
        raise ValueError('Operator credential differs')
    return value


def adapters(settings,secrets,presets):
    if not isinstance(secrets,dict) or set(secrets)!={'inboundToken','application','engine','callback'}:
        raise ValueError('Operator credential roles differ')
    inbound=token(secrets['inboundToken'])
    resolved={}
    for role,reference in [('application',settings['applicationCredentialReference']),
            ('engine',settings['engine']['credentialReference']),('callback',settings['callbackCredentialReference'])]:
        values=secrets[role]
        if not isinstance(values,dict) or set(values)!={reference}:
            raise ValueError('Operator credential reference differs')
        value=values[reference]
        resolved[role]=(reference,application_credentials(value) if role=='application' else token(value,role=='engine'))
    if not isinstance(presets,dict) or set(presets)!=set(contract.PRESET_IDS):
        raise ValueError('Explicit preset names differ')
    for rows in presets.values():
        if not isinstance(rows,list) or len(rows)>128:raise ValueError('Explicit preset options differ')
        names=[]
        for row in rows:
            if not isinstance(row,dict) or set(row)!={'name','value'}:raise ValueError('Explicit preset option differs')
            name,value=row['name'],row['value']
            if not isinstance(name,str) or not 1<=len(name)<=128:raise ValueError('Explicit preset option name differs')
            if (type(value) not in (str,int,float,bool) or (isinstance(value,str) and len(value)>4096)
                    or (type(value) in (int,float) and not math.isfinite(value))):
                raise ValueError('Explicit preset option value differs')
            names.append(name)
        if len(names)!=len(set(names)):raise ValueError('Explicit preset option names repeat')
    saved=copy.deepcopy(presets)
    def resolver(role):
        reference,value=resolved[role]
        def read(requested):
            if requested!=reference:raise ValueError('Original CLI credential reference differs')
            return copy.deepcopy(value)
        return read
    def options(request):
        preset=request.get('presetId') or 'balanced'
        if preset not in saved:raise ValueError('Original CLI preset differs')
        return copy.deepcopy(saved[preset])
    return inbound,{'application_credentials':resolver('application'),'engine_credentials':resolver('engine'),
        'callback_credentials':resolver('callback'),'options':options}


class Parser(argparse.ArgumentParser):
    def error(self,message):raise ValueError('Explicit worker command arguments differ')


def run(argv):
    parser=Parser(description='Run the explicitly configured original worker. Retain its private root for recovery.')
    for name in ('root','configuration','credentials','presets','host'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--port',required=True,type=int)
    parser.add_argument('--max-queued',required=True,type=int)
    parser.add_argument('--max-connections',type=int,default=4)
    parser.add_argument('--max-body',type=int,default=32*1024*1024)
    parser.add_argument('--socket-timeout',type=float,default=2)
    args=parser.parse_args(argv)
    settings=configuration(document(args.configuration))
    inbound,bindings=adapters(settings,document(args.credentials),document(args.presets))
    service=Service(absolute(args.root),settings,host=args.host,port=args.port,inbound_token=inbound,
        max_queued=args.max_queued,max_connections=args.max_connections,max_body=args.max_body,
        socket_timeout=args.socket_timeout,**bindings)
    previous={};server=service.server;requested_stop=False
    def stop(*_):
        nonlocal requested_stop
        requested_stop=True;service.stop()
    try:
        for kind in (signal.SIGINT,signal.SIGTERM):
            previous[kind]=signal.signal(kind,stop)
        try:service.run()
        except InterruptedError:
            if not requested_stop:raise
    finally:
        try:service.stop();server.server_close()
        finally:
            for kind,handler in previous.items():signal.signal(kind,handler)


def main(argv=None):
    try:run(sys.argv[1:] if argv is None else argv)
    except Exception:
        print('Original worker could not run. Check explicit private inputs and retain the original root.',file=sys.stderr)
        return 2
    return 0


if __name__=='__main__':sys.exit(main())
