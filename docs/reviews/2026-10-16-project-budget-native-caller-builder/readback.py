"""Independent credential-free row comparator, supplied readbacks only, no transport.

Input origin, connection independence, commits and catalog truth remain recorder duties.
This reader compares complete supplied public rows and selected auth fields.
"""

A = '5dcfd625-1d54-483b-b918-8490deab63f1'
B = 'b207943e-6853-49de-9b9d-205481a69c0c'
ACTORS = dict(zip(('a_owner','a_owner2','a_admin','a_member','a_viewer','b_only','dual','outsider','revocable'), (
 'f174c91a-36e5-4477-90a5-5017b188f314','fc66d23b-981a-49cc-9cb9-a7822d405fa3',
 'dec579c4-fc71-44cc-b377-953309df0446','cf41d6a7-dc13-4c6b-a330-d7debe344d94',
 'a786239d-a557-4145-ab6e-30a93c155ba2','465906f8-7d27-4794-8db2-1cb517652a32',
 'a86c371d-d014-4c43-a09b-f91823b8ad4c','91c0f81f-46d0-48de-9652-59229cc7da91',
 'd3194ec6-df7c-4917-b747-2e090a2c78fb')))
ROLES = {(A,ACTORS[k]):v for k,v in [('a_owner','owner'),('a_owner2','owner'),('a_admin','admin'),
 ('a_member','member'),('a_viewer','viewer'),('dual','admin'),('revocable','member')]}
ROLES.update({(B,ACTORS['b_only']):'owner',(B,ACTORS['dual']):'admin'})


def insist(value, label):
    if not value:
        raise AssertionError(label)


def index(rows, keys):
    indexed = {tuple(r[k] for k in keys): r for r in rows}
    insist(len(indexed)==len(rows), 'readback-duplicate-rows')
    return indexed


def prerequisite_rows(before, after):
    """Return actual automatic IDs only after exact selected row-set comparisons."""
    insist(set(before)==set(after)=={'users','workspaces','members','cutoffChanges','cutoffDeletions','baselines'}, 'readback-section-set')
    insist(before['baselines']==after['baselines']==[], 'readback-new-workspace-baseline-absence')
    for key in ('cutoffChanges','cutoffDeletions'):
        insist(index(before[key],('id',))==index(after[key],('id',)), 'readback-cutoff-rows-preserved')
    insist(before['users']==[], 'readback-fresh-users')
    users = index(after['users'], ('id',))
    insist(set(users)=={(v,) for v in ACTORS.values()}, 'readback-auth-identities')
    fields={'id','aud','role','email','raw_app_meta_data','raw_user_meta_data','created_at','updated_at'}
    for name, ident in ACTORS.items():
        row=users[(ident,)]
        insist(set(row)==fields and row['aud']==row['role']=='authenticated' and
               row['email']==name+'-'+ident+'@budget-native.invalid' and row['raw_app_meta_data']=={} and
               row['raw_user_meta_data']=={'org_name':'SYNTHETIC budget caller '+name}, 'readback-auth-shape')
    wb=index(before['workspaces'],('id',)); wa=index(after['workspaces'],('id',))
    mb=index(before['members'],('workspace_id','user_id')); ma=index(after['members'],('workspace_id','user_id'))
    insist(all(wa.get(k)==v for k,v in wb.items()) and all(ma.get(k)==v for k,v in mb.items()),
           'readback-prior-rows-preserved')
    addedw={k:v for k,v in wa.items() if k not in wb}
    addedm={k:v for k,v in ma.items() if k not in mb}
    explicit={k:v for k,v in addedm.items() if k[0] in (A,B)}
    insist({k:v['role'] for k,v in explicit.items()}==ROLES, 'readback-explicit-roleset')
    auto={}
    for name, ident in ACTORS.items():
        rows=[r for (w,u),r in addedm.items() if u==ident and w not in (A,B)]
        insist(len(rows)==1 and rows[0]['role']=='owner', 'readback-one-automatic-owner-per-user')
        workspace=rows[0]['workspace_id']
        insist((workspace,) in addedw, 'readback-auto-workspace-added')
        row=addedw[(workspace,)]
        insist(row['name']=='SYNTHETIC budget caller '+name and
               row['slug']=='synthetic-budget-caller-'+name.replace('_','-')+'-'+ident[:8],
               'readback-auto-name-slug')
        auto[ident]=workspace
    insist(len(set(auto.values()))==9 and set(addedw)=={(A,),(B,)}|{(w,) for w in auto.values()},
           'readback-all-workspace-sideeffects')
    insist(set(addedm)==set(ROLES)|{(w,u) for u,w in auto.items()}, 'readback-all-membership-sideeffects')
    for label,w in [('a',A),('b',B)]:
        insist(addedw[(w,)]['name']=='SYNTHETIC budget '+label.upper() and
               addedw[(w,)]['slug']=='synthetic-budget-'+label+'-9c47bd610f2a49e8a35c706d',
               'readback-explicit-workspaces')
    return auto


def ordinary_rows(actor, automatic, supplied, full_after):
    """Compare the caller's own memberships, visible workspaces and write eligibility."""
    insist(actor in ACTORS.values(), 'readback-known-caller')
    expectedm=[r for r in full_after['members'] if r['user_id']==actor]
    insist(index(supplied['members'],('workspace_id','user_id'))==index(expectedm,('workspace_id','user_id')),
           'readback-ordinary-own-memberships')
    ids={r['workspace_id'] for r in expectedm}
    insist(automatic[actor] in ids, 'readback-ordinary-auto-preserved')
    expectedw=[{k:r[k] for k in ('id','name','slug')} for r in full_after['workspaces'] if r['id'] in ids]
    insist(index(supplied['workspaces'],('id',))==index(expectedw,('id',)), 'readback-ordinary-visible-workspaces')
    eligibility={r['workspace_id']:r['role'] in ('owner','admin','member') for r in expectedm if r['workspace_id'] in (A,B)}
    insist(supplied['writerEligibility']==eligibility, 'readback-ordinary-writer-roleset')
