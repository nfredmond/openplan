"""Parent-only allocation/archive steps around the retained V6 operating stages."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

import journal as j
import memory_storage as m


def admission():
    packet=json.loads((j.DURABLE/'packet.json').read_text())
    approved=json.loads((j.DURABLE/'admission.json').read_text())
    j.require(approved.get('head')==j.HEAD and approved.get('appTree')==j.TREE and
        approved.get('acceptedByParent') is True and
        approved.get('capacityAdmitted') is True and
        approved.get('packetSealSHA256')==m.sha(j.DURABLE/'packet.json') and
        type(approved.get('reviewCommit')) is str and re.fullmatch('[0-9a-f]{40}',approved['reviewCommit']),
        'final-parent-review-admission')
    j.require(packet['head']==j.HEAD and packet['appTree']==j.TREE,'final-packet-source')
    return packet,approved


def allocate():
    packet,approved=admission();capacity=m.observe_capacity()
    j.require(not m.ROOT.exists() and not m.ROOT.is_symlink(),'memory-root-reserved')
    for name,value in packet['sealed'].items():
        path=j.DURABLE/'templates'/name
        j.require(path.is_file() and not path.is_symlink() and m.sha(path)==value['sha256'] and
            path.stat().st_mode&0o777==value['mode'],'allocation-input-seal')
    def action():
        m.ROOT.mkdir(mode=0o700)
        for name in ['execution','home','cache','npm-cache','tmp','observer-home','observer-receipts']:
            (m.ROOT/name).mkdir(mode=0o700)
        for name,value in packet['sealed'].items():
            target=m.ROOT/name
            with target.open('xb') as stream:
                stream.write((j.DURABLE/'templates'/name).read_bytes());stream.flush();os.fsync(stream.fileno())
            target.chmod(value['mode'])
            j.require(m.sha(target)==value['sha256'],'allocation-copy-sha')
        j.sync_directory(m.ROOT)
        return {'workingRoot':str(m.ROOT),'capacity':capacity,'source':j.HEAD}
    j.effect('allocate-working-root',{'packetSealSHA256':m.sha(j.DURABLE/'packet.json'),
        'acceptedReview':approved['reviewCommit'],'workingRoot':str(m.ROOT)},action)
    # A real execute probe belongs only to the later admitted allocation step.
    probe=m.ROOT/'execution/memory-execution-probe.sh'
    with probe.open('x') as stream:
        stream.write('#!/bin/sh\nexit 0\n');stream.flush();os.fsync(stream.fileno())
    probe.chmod(0o700);j.sync_directory(probe.parent)
    result=j.execute('memory-execution-probe',[str(probe)],env={'PATH':'/usr/bin:/bin'},timeout=5)
    j.require(result.returncode==0,'memory-execution-probe')


def archive():
    admission()
    for suffix in ['build','web']:
        unit='openplan-pr330-memory-f0cbeddff-r2-'+suffix+'.service'
        result=subprocess.run(['/usr/bin/systemctl','--user','show',unit,'--property=ActiveState','--value'],
            env={'PATH':'/usr/bin:/bin','HOME':str(j.DURABLE/'home'),'XDG_RUNTIME_DIR':'/run/user/1000',
                 'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'},capture_output=True,timeout=5)
        j.require(result.returncode==0 and result.stdout.decode().strip() in {'inactive','failed'},'archive-unit-not-quiescent')
    run=m.ROOT/'execution';result=run/'build-result.json'
    outcome='failed-or-incomplete'
    if result.is_file() and not result.is_symlink():
        value=json.loads(result.read_text())
        j.require(value['app']['head']==j.HEAD and value['returncode']==0,'archive-build-identity')
        j.require(value['buildId']==(m.ROOT/'candidate/openplan/.next/BUILD_ID').read_text().strip(),'archive-build-id')
        outcome='successful'
    destination=j.DURABLE/'build-record'
    j.require(not destination.exists() and not destination.is_symlink(),'archive-record-reserved')
    def action():
        destination.mkdir(mode=0o700);j.sync_directory(destination.parent)
        snapshot=run/'durable-custody'
        j.require(not snapshot.exists(),'custody-snapshot-reserved')
        snapshot.mkdir(mode=0o700)
        for name in ['journal','receipts']:
            if (j.DURABLE/name).is_dir():
                shutil.copytree(j.DURABLE/name,snapshot/name,
                    ignore=shutil.ignore_patterns('archive-build','unit-archive'))
        manifest=m.capture(m.ROOT,destination,{'head':j.HEAD,'appTree':j.TREE},outcome)
        return {'archiveSHA256':manifest['archiveSha256'],
            'manifestSHA256':m.sha(destination/'archive-ready.json'),'outcome':outcome}
    j.effect('archive-build',{'outcome':outcome,'workingRoot':str(m.ROOT)},action)


def main():
    os.umask(0o077)
    j.require(len(sys.argv)==2 and sys.argv[1] in {'allocate','archive'},'storage-stage')
    {'allocate':allocate,'archive':archive}[sys.argv[1]]()


if __name__=='__main__':
    main()
