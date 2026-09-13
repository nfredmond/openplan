"""Prove the TypeScript snapshot consumer rejects malformed/partial replies."""
from pathlib import Path
import hashlib,json,subprocess

review=Path(__file__).parent
root=review.resolve().parents[2]
app=root/'openplan'
source=app/'src/lib/engagement/translation-snapshot.ts'
original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-snapshot/client-controls')
private.mkdir(exist_ok=True)
def change(old,new):
    assert old in original,old
    return original.replace(old,new,1)
cases=[
 ('baseline',original,None),
 ('harmless-comment',original+'\n// Harmless consumer note.\n',None),
 ('skip-envelope-scope',change('snapshot.campaignId !== campaignId || snapshot.campaign.id !== campaignId','false'),'campaign row'),
 ('skip-row-scope',change('rows.some(row => row.campaign_id !== campaignId)','false'),'foreign source row'),
 ('ignore-census',change('rows.length !== snapshot.counts[group]','false'),'partial inventory'),
 ('allow-duplicate-identity',change('new Set(rows.map(row => row.id)).size !== rows.length','false'),'duplicate identity'),
 ('allow-orphan-option',change('if (snapshot.options.some(row => !snapshot.questions.some(question => question.id === row.question_id)))','if (false)'),'orphan option'),
 ('allow-duplicate-address',change('addresses.has(key) ||','false ||'),'duplicate translation address'),
 ('allow-missing-source',change('translationSnapshotSource(snapshot, { entityType: row.entity_type, entityId: row.entity_id, field: row.field }) === null','false'),'missing translation source'),
 ('allow-zero-revision',change('z.number().int().positive()','z.number().int().nonnegative()'),'unavailable revision'),
 ('allow-unsafe-revision',change('z.number().int().positive()','z.number().positive()'),'unsafe integer revision'),
 ('ignore-unknown-columns',original.replace('.strict()',''),'unknown source column'),
 ('allow-malformed-id',change('const id = z.string().uuid();','const id = z.string();'),'malformed source identifier'),
 ('lose-raw-source',change('return { text, sourceLocale:', 'return { text: text?.trim() ?? null, sourceLocale:'),'retains raw source and saved words'),
 ('lose-raw-wording',change('translated_text: z.string(),','translated_text: z.string().trim(),'),'retains raw source and saved words'),
 ('ignore-parent-publication',change('row.is_active && parent.is_active && parent.status === "published"','row.is_active && parent.is_active'),'resolves publication through question parents'),
 ('ignore-parent-active',change('row.is_active && parent.is_active && parent.status === "published"','row.is_active && parent.status === "published"'),'resolves publication through question parents'),
 ('ignore-question-publication',change('row.is_active && row.status === "published"','row.is_active'),'resolves publication through question parents'),
 ('ignore-response-publication',change('visible = row.status === "published";','visible = true;'),'resolves publication through question parents'),
 ('blank-source-is-available',change('text.trim().length > 0','true'),'retains raw source and saved words'),
 ('ignore-error-with-data',change('if (reply.error) return','if (false) return'),'withholds a partial reply with an error'),
 ('ignore-pending-schema',change('["PGRST202", "42883"].includes(reply.error.code)','false'),'withholds a partial reply with an error'),
 ('omit-required-column',change('label: words, description: words','label: words, description: words.optional()'),'withholds missing source columns'),
]
results=[]
try:
    for name,body,failure in cases:
        source.write_text(body)
        run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-translation-snapshot.test.ts'],cwd=app,capture_output=True,text=True,timeout=45)
        output=run.stdout+run.stderr
        (private/(name+'.log')).write_text(output)
        if failure is None: assert run.returncode==0 and '17 passed' in output,(name,output)
        else: assert run.returncode!=0 and failure in output,(name,output)
        results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':failure})
finally:
    source.write_text(original)
(review/'translation-snapshot-client-results.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'results':results,'limits':'Consumer contract and source visibility. SQL/HTTP scope and transaction behavior are exercised separately; no editor navigation or generation acceptance.'},indent=2)+'\n')
print(json.dumps(results))
