from pathlib import Path
DB_ID='6d7969d9b92f6bca1b1e6811cde9c313db4fd7b1ab33539c082a3016786962ef'
DB_NAME='supabase_db_openplan-restore-target-2026101132'
DATABASE='openplan_attempt_cli_fc468084c83c4a2499c60ab61d48db47'
NETWORK='openplan-gtfs-separate-cluster-api-20261011-01'
API='http://127.74.9.11:29941'
HEAD='bf1f6ffa710b11b7f36747a676943edab667a4ae'
ORIGINALS={}
IMAGES={'rest': 'sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326', 'auth': 'sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd', 'storage': 'sha256:a4846b3329f3afd52cd2ae31b89a0c1ae841221e9d3a22d55db65f9dca2a72b6', 'gateway': 'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d'}
def require(value,reason):
 if not value:raise ValueError(reason)
def verify_original(*args,**kwargs):
 raise ValueError('No existing API service is owned by this drill')
