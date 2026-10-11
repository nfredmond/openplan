import re
from scope import require

def fresh(name):
    require(re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',name),'expanded-property-target')

import subprocess
from scope import DB_ID,DATABASE
def sql(database,query):
    require(database in (DATABASE,'postgres','template1') or re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',database),'expanded-property-source')
    result=subprocess.run(['docker','exec',DB_ID,'psql','-U','supabase_admin','-d',database,'-XqAt','-v','ON_ERROR_STOP=1','-c',query],capture_output=True,text=True,timeout=90)
    require(result.returncode==0,'expanded-property-query')
    return result.stdout.strip()
