"""Logical node/link identity independent of SQLite page layout and metadata."""
import hashlib
import json
import math
from pathlib import Path
import sqlite3


def _json(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def _value(value):
    if value is None: return ['null']
    if isinstance(value,bytes): return ['blob',value.hex()]
    if isinstance(value,str): return ['text',value]
    if isinstance(value,int): return ['integer',str(value)]
    if isinstance(value,float) and math.isfinite(value): return ['real',value.hex()]
    raise ValueError('Network source contains an unsupported or nonfinite value')


def identity(database):
    """Read a consistent read-only snapshot of every node and link column.

    No geometry extension or model engine is loaded. Geometry blobs remain exact
    values. Source identity is distinct from the subsequently transformed graph.
    """
    path=Path(database)
    if not path.is_absolute() or path.resolve(strict=True)!=path or not path.is_file():
        raise ValueError('Network source requires an absolute unaliased database file')
    connection=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)
    try:
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        records={}
        for table,key in (('nodes','node_id'),('links','link_id')):
            row=connection.execute('SELECT type,sql FROM sqlite_schema WHERE name=?',(table,)).fetchone()
            if row is None or row[0]!='table' or 'VIRTUAL TABLE' in row[1].upper():
                raise ValueError('Network source requires ordinary node and link tables')
            columns=sorted(item[1] for item in connection.execute('PRAGMA table_info("'+table+'")'))
            if key not in columns: raise ValueError('Network source identity column missing')
            quoted=','.join('"'+name.replace('"','""')+'"' for name in columns)
            digest=hashlib.sha256();digest.update(_json(columns)+b'\n')
            count=0;previous=None;key_index=columns.index(key)
            for values in connection.execute('SELECT '+quoted+' FROM "'+table+'" ORDER BY "'+key+'"'):
                item_id=values[key_index]
                if not isinstance(item_id,int) or item_id==previous:
                    raise ValueError('Network source identities must be unique integers')
                previous=item_id
                digest.update(_json([_value(value) for value in values])+b'\n');count+=1
            if count==0: raise ValueError('Network source table is empty')
            records[table]={'columns':columns,'count':count,'sha256':digest.hexdigest()}
        return {'schema':'openplan.assignment-network-source.v1','tables':records,
                'sha256':hashlib.sha256(_json(records)).hexdigest()}
    finally:
        connection.close()
