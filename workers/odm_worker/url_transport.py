"""Supervised source GETs with explicit address policy and exact byte delivery."""
import hashlib
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import selectors
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urljoin, urlsplit

from draft_http import Transport as DraftTransport, exact_input, watch_parent

CHUNK = 128 * 1024
METADATA_LIMIT = 128 * 1024
ERROR_LIMIT = 4096
REDIRECTS = {301, 302, 303, 307, 308}
NAT64 = ipaddress.ip_network('64:ff9b::/96')


def deadline_check(deadline):
    if type(deadline) not in (int, float) or not math.isfinite(deadline):
        raise ValueError('Source transport deadline must be finite')
    if time.monotonic() >= deadline:raise TimeoutError('Source transport deadline exceeded')


def parse_url(url, ports):
    if not isinstance(url, str) or not url or len(url) > 65536 or any(ord(char) <= 32 or ord(char) >= 127 for char in url) or '\\' in url:
        raise ValueError('Source URL syntax differs')
    try:parts = urlsplit(url);port = parts.port
    except ValueError:raise ValueError('Source URL syntax differs') from None
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username is not None or parts.password is not None or '#' in url:
        raise ValueError('Source URL scheme, host or credentials differ')
    if '%' in parts.hostname:raise ValueError('Source URL host differs')
    port = (443 if parts.scheme == 'https' else 80) if port is None else port
    if port not in ports:raise ValueError('Source URL port is not approved')
    return parts, port


def address_allowed(address, networks):
    value = ipaddress.ip_address(address)
    if value.is_unspecified or value.is_multicast or getattr(value, 'ipv4_mapped', None) is not None:
        return False
    if value.version == 6 and value in NAT64:return False
    return (value.is_global and not value.is_reserved) or any(value.version == net.version and value in net for net in networks)


def resolve(parts, port, networks):
    rows = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    if not rows or any(row[0] not in (socket.AF_INET, socket.AF_INET6) or row[1] != socket.SOCK_STREAM or not address_allowed(row[4][0], networks) for row in rows):
        raise ValueError('Source URL resolved address is not approved')
    return rows


def response_length(headers, max_bytes):
    encodings=headers.get_all('Content-Encoding') or []
    lengths=headers.get_all('Content-Length') or []
    transfers=headers.get_all('Transfer-Encoding') or []
    if encodings and encodings!=['identity'] or len(lengths)>1 or lengths and transfers or transfers and transfers!=['chunked']:
        raise ValueError('Source response encoding or length differs')
    if not lengths:return None
    if not lengths[0].isascii() or not lengths[0].isdigit():raise ValueError('Source response length differs')
    length=int(lengths[0])
    if length>max_bytes:raise ValueError('Source response bytes exceed their bound')
    return length


class Transport:
    def __init__(self, *, allowed_networks=(), allowed_ports=(80, 443), max_redirects=5, cancelled=lambda: False, ca_file=None):
        if sys.platform != 'linux' or not callable(cancelled):raise ValueError('Linux source supervision and cancellation are required')
        if not isinstance(allowed_networks, (tuple, list)) or any(not isinstance(net,str) or not net for net in allowed_networks) or not isinstance(allowed_ports, (tuple, list)) or not allowed_ports or any(type(port) is not int or not 1 <= port <= 65535 for port in allowed_ports):
            raise ValueError('Explicit source address policy is required')
        self.networks = tuple(ipaddress.ip_network(net, strict=True) for net in allowed_networks)
        self.ports = tuple(allowed_ports)
        if type(max_redirects) is not int or not 0 <= max_redirects <= 5:raise ValueError('Source redirect limit differs')
        if ca_file is not None and (not isinstance(ca_file, str) or not Path(ca_file).is_absolute()):raise ValueError('Source TLS trust file must be an absolute path')
        self.max_redirects=max_redirects;self.cancelled=cancelled;self.ca_file=ca_file

    def _check(self, deadline):
        decision=self.cancelled()
        if type(decision) is not bool:raise ValueError('Source transport cancellation must be a boolean')
        if decision:raise InterruptedError('Source transport cancelled')
        deadline_check(deadline)

    def __call__(self, url, output, max_bytes, deadline):
        self._check(deadline);parse_url(url, self.ports)
        if type(max_bytes) is not int or max_bytes < 0 or max_bytes > 2**63-1:raise ValueError('Source transport byte limit differs')
        if not callable(getattr(output, 'write', None)):raise ValueError('Source transport requires a byte writer')
        metadata=json.dumps({'url':url,'ports':self.ports,'networks':[str(net) for net in self.networks],
            'redirects':self.max_redirects,'caFile':self.ca_file,'maxBytes':max_bytes,'deadline':deadline},allow_nan=False,separators=(',', ':')).encode()
        if len(metadata)>METADATA_LIMIT:raise ValueError('Source transport metadata exceeds its bound')
        self._check(deadline);lifetime_read,lifetime_write=os.pipe();process=None
        try:
            process=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--child',str(lifetime_read)],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,pass_fds=(lifetime_read,),bufsize=0,
                env={key:value for key,value in os.environ.items() if key in {'PATH','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR'}})
            os.close(lifetime_read);lifetime_read=None
            pending=struct.pack('!I',len(metadata))+metadata;buffer=bytearray();errors=bytearray();count=0;checksum=hashlib.sha256();finished=False
            with selectors.DefaultSelector() as selector:
                for name,handle,event in [('input',process.stdin,selectors.EVENT_WRITE),('output',process.stdout,selectors.EVENT_READ),('error',process.stderr,selectors.EVENT_READ)]:
                    os.set_blocking(handle.fileno(),False);selector.register(handle,event,name)
                while selector.get_map():
                    self._check(deadline)
                    for key,_event in selector.select(min(0.05,max(0,deadline-time.monotonic()))):
                        self._check(deadline)
                        if key.data=='input':
                            try:written=os.write(key.fd,pending)
                            except BlockingIOError:continue
                            pending=pending[written:]
                            if not pending:selector.unregister(key.fileobj);key.fileobj.close()
                            continue
                        try:chunk=os.read(key.fd,CHUNK)
                        except BlockingIOError:continue
                        if not chunk:selector.unregister(key.fileobj);key.fileobj.close();continue
                        if key.data=='error':
                            errors.extend(chunk)
                            if len(errors)>ERROR_LIMIT:raise ValueError('Source transport diagnostics exceed their bound')
                            continue
                        buffer.extend(chunk)
                        while len(buffer)>=5:
                            kind=bytes(buffer[:1]);size=struct.unpack('!I',buffer[1:5])[0]
                            if kind not in (b'B',b'F') or size>CHUNK or finished:raise ValueError('Source transport frame differs')
                            if len(buffer)<size+5:break
                            payload=bytes(buffer[5:5+size]);del buffer[:5+size]
                            if kind==b'B':
                                if not payload or len(payload)>max_bytes-count:raise ValueError('Source transport bytes exceed their bound')
                                self._check(deadline)
                                if output.write(payload)!=len(payload):raise OSError('Source transport local write did not finish')
                                checksum.update(payload);count+=len(payload)
                            else:
                                if len(payload)!=40 or payload!=struct.pack('!Q',count)+checksum.digest():raise ValueError('Source transport completion differs')
                                finished=True
            self._check(deadline)
            if process.wait(timeout=max(0.001,deadline-time.monotonic()))!=0 or errors or buffer or not finished:
                raise ValueError('Source transport did not complete')
            return count
        finally:
            if lifetime_read is not None:os.close(lifetime_read)
            os.close(lifetime_write)
            if process is not None:
                DraftTransport._stop(process)
                for handle in (process.stdin,process.stdout,process.stderr):
                    if handle is not None:handle.close()


def connection(parts, port, rows, deadline, ca_file):
    family,kind,proto,_name,address=rows[0]
    handle=socket.socket(family,kind,proto)
    try:
        handle.settimeout(max(0.001,deadline-time.monotonic()));handle.connect(address)
        if parts.scheme=='https':handle=ssl.create_default_context(cafile=ca_file).wrap_socket(handle,server_hostname=parts.hostname)
        result=http.client.HTTPConnection(parts.hostname,port,timeout=max(0.001,deadline-time.monotonic()))
        result.sock=handle
        return result
    except BaseException:handle.close();raise


def child(lifetime):
    threading.Thread(target=watch_parent,args=(lifetime,),daemon=True).start()
    size=struct.unpack('!I',exact_input(4))[0]
    if size>METADATA_LIMIT:raise ValueError('Source transport metadata exceeds its bound')
    metadata=json.loads(exact_input(size));deadline=metadata['deadline'];url=metadata['url'];count=0;checksum=hashlib.sha256()
    networks=tuple(ipaddress.ip_network(net,strict=True) for net in metadata['networks'])
    for hop in range(metadata['redirects']+1):
        deadline_check(deadline);parts,port=parse_url(url,metadata['ports']);rows=resolve(parts,port,networks)
        deadline_check(deadline);client=connection(parts,port,rows,deadline,metadata['caFile'])
        try:
            client.request('GET',(parts.path or '/')+('?' + parts.query if parts.query else ''),headers={'User-Agent':'openplan-odm-worker','Accept-Encoding':'identity'})
            response=client.getresponse();deadline_check(deadline)
            if response.status in REDIRECTS:
                locations=response.headers.get_all('Location') or []
                if len(locations)!=1 or hop==metadata['redirects']:raise ValueError('Source redirect differs')
                target=urljoin(url,locations[0]);following,_port=parse_url(target,metadata['ports'])
                if parts.scheme=='https' and following.scheme!='https':raise ValueError('Source HTTPS redirect downgrade refused')
                url=target;continue
            if response.status!=200:raise ValueError('Source response status differs')
            length=response_length(response.headers,metadata['maxBytes'])
            while True:
                deadline_check(deadline);chunk=response.read1(min(CHUNK,metadata['maxBytes']-count+1))
                if not chunk:break
                if len(chunk)>metadata['maxBytes']-count:raise ValueError('Source response bytes exceed their bound')
                sys.stdout.buffer.write(b'B'+struct.pack('!I',len(chunk))+chunk);sys.stdout.buffer.flush()
                checksum.update(chunk);count+=len(chunk)
            if length is not None and count!=length:raise ValueError('Source response ended before its declared length')
            deadline_check(deadline);payload=struct.pack('!Q',count)+checksum.digest()
            sys.stdout.buffer.write(b'F'+struct.pack('!I',len(payload))+payload);sys.stdout.buffer.flush();return
        finally:client.close()


if __name__=='__main__':
    try:
        if len(sys.argv)!=3 or sys.argv[1]!='--child':raise ValueError('Owned source child invocation is required')
        child(int(sys.argv[2]))
    except Exception:
        sys.stderr.write('Original source transport failed\n');sys.exit(2)
