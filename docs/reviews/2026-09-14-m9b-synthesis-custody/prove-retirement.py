"""Exercise retirement, historical display and navigation guards with controls and deliberate faults."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
route = app / 'src/app/api/engagement/campaigns/[campaignId]/synthesis/route.ts'
panel = app / 'src/components/engagement/engagement-synthesis-panel.tsx'
page = app / 'src/app/(app)/engagement/[campaignId]/page.tsx'
help_page = app / 'src/app/(app)/help/page.tsx'
onboarding = app / 'src/components/onboarding/first-run-checklist.tsx'
paths = [route, panel, page, help_page, onboarding]
originals = {p: p.read_text() for p in paths}
all_tests = ['engagement-synthesis-retired-route.test.ts', 'engagement-synthesis-legacy-panel.test.tsx', 'every-api-route-has-a-caller.test.ts', 'write-policy-coverage-guard.test.ts', 'engagement-campaign-detail-page.test.tsx', 'help-page.test.tsx', 'first-run-checklist.test.tsx', 'dashboard-page.test.tsx', 'planner-copy-says-the-plain-thing.test.ts']
cases = [('baseline', [], all_tests, []), ('harmless-comment', [(route, '', '// Harmless retirement documentation.\n')], all_tests, [])]
def fault(name, path, before, after, tests, expected):
    cases.append((name, [(path, before, after)], tests, expected))
fault('success-shaped-refusal', route, '{ status: 410, headers:', '{ status: 200, headers:', ['engagement-synthesis-retired-route.test.ts', 'every-api-route-has-a-caller.test.ts'], ['refuses old requests', 'keeps the excused synthesis generator retired'])
fault('cacheable-refusal', route, 'private, no-store', 'public, max-age=60', ['engagement-synthesis-retired-route.test.ts'], ['refuses old requests'])
fault('missing-audit', route, '  createApiAuditLogger("engagement.synthesis.retired", request).warn("engagement_synthesis_write_retired", { status: 410 });', '', ['engagement-synthesis-retired-route.test.ts'], ['audits retirement'])
fault('query-disclosure', route, '{ status: 410 });', '{ status: 410, submittedQuery: request.nextUrl.search });', ['engagement-synthesis-retired-route.test.ts'], ['audits retirement'])
fault('consumes-body', route, 'export function POST(request: NextRequest) {', 'export function POST(request: NextRequest) { void request.text();', ['engagement-synthesis-retired-route.test.ts'], ['refuses old requests'])
for name, imported, module, invocation in [
    ('database-effect', 'createClient', '@/lib/supabase/server', 'createClient()'),
    ('provider-effect', 'generateEngagementSynthesis', '@/lib/engagement/ai-synthesis', 'generateEngagementSynthesis([])'),
]:
    cases.append((name, [(route, '', f'import {{ {imported} }} from "{module}";\n'), (route, 'export function POST(request: NextRequest) {', f'export function POST(request: NextRequest) {{ void {invocation};')], ['engagement-synthesis-retired-route.test.ts'], ['refuses old requests']))
fault('missing-recovery-direction', route, 'Keep a copy of any unsaved text, then reopen Analysis and use retained synthesis sources and staff reviews.', 'Try again later.', ['engagement-synthesis-retired-route.test.ts'], ['refuses old requests'])
fault('lost-historical-narrative', panel, 'stripFactCitationTokens(synthesis.narrative)', '""', ['engagement-synthesis-legacy-panel.test.tsx'], ['preserves historical words', 'reads the current server record'])
fault('invented-generation-button', panel, '<p className="text-sm font-semibold text-foreground">', '<button>Generate</button><p className="text-sm font-semibold text-foreground">', ['engagement-synthesis-legacy-panel.test.tsx'], ['preserves historical words', 'does not invent'])
fault('undisclosed-coverage-limit', panel, 'omit survey answers and shorten comment text.', 'cover every contribution.', ['engagement-synthesis-legacy-panel.test.tsx'], ['preserves historical words'])
fault('invented-analysis-count', panel, '{synthesis.analyzed_item_count} analyzed', '{synthesis.item_count} analyzed', ['engagement-synthesis-legacy-panel.test.tsx'], ['preserves historical words'])
fault('hide-unassessed-fallback', panel, 'synthesis?.source === "deterministic-fallback"', 'false', ['engagement-synthesis-legacy-panel.test.tsx'], ['preserves historical words'])
fault('history-hidden-by-current-intake', page, '{campaign.ai_synthesis_json ? (', '{counts.statusCounts.approved > 0 ? (', ['engagement-campaign-detail-page.test.tsx'], ['keeps exact earlier synthesis visible'])
fault('wrong-history-prop', page, 'initialSynthesizedAt={campaign.ai_synthesized_at}', 'initialSynthesizedAt={null}', ['engagement-campaign-detail-page.test.tsx'], ['keeps exact earlier synthesis visible'])
fault('unreachable-replacement', page, '{canManageContextLayers ? <EngagementSynthesisSources', '{false ? <EngagementSynthesisSources', ['engagement-campaign-detail-page.test.tsx'], ['mounts retained sources', 'keeps every key section mounted', 'puts the publish flow', 'keeps moderation above'])
fault('unverified-write-restored', route, '', 'import { createClient } from "@/lib/supabase/server";\nexport async function discardedWrite() { const supabase = await createClient(); await supabase.from("engagement_campaigns").update({ ai_synthesis_json: {} }).eq("id", "synthetic"); }\n', ['write-policy-coverage-guard.test.ts'], ['adds no new UPDATE or DELETE'])
fault('help-directions-removed', help_page, 'Engagement source capture and staff synthesis reviews work without an AI key.', 'Use the old AI generator.', ['help-page.test.tsx'], ['lists which features need an AI key'])
fault('onboarding-promotes-retired-generator', onboarding, 'the Planner Agent, narrative drafting, and comment translation', 'the Planner Agent, AI synthesis of public comments, narrative drafting, and comment translation', ['first-run-checklist.test.tsx', 'dashboard-page.test.tsx'], ['leads with the AI step, shows it outstanding', 'leads with the AI step and links to integration setup'])
fault('plain-copy-regression', panel, 'full consultation.', 'full campaign.', ['planner-copy-says-the-plain-thing.test.ts'], ['uses no term from the ledger'])
results = []
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')
try:
    with tempfile.TemporaryDirectory(prefix='openplan-retirement-') as temporary:
        for name, edits, tests, expected in cases:
            for path, raw in originals.items(): path.write_text(raw)
            for path, before, after in edits:
                raw = path.read_text()
                assert before in raw, (name, before)
                path.write_text(after + raw if before == '' else raw.replace(before, after, 1))
            report = Path(temporary) / 'result.json'
            run = subprocess.run(['npx', 'vitest', 'run', *['src/test/' + test for test in tests], '--reporter=json', '--outputFile=' + str(report)], cwd=app, capture_output=True, text=True)
            (private / ('retirement-mutation-' + name + '.log')).write_text(run.stdout + run.stderr)
            payload = json.loads(report.read_text())
            failures = [test['fullName'] for suite in payload['testResults'] for test in suite['assertionResults'] if test['status'] == 'failed']
            correct = (run.returncode == 0 and payload['numPassedTests'] == 130 and payload['numFailedTests'] == 0) if not expected else (run.returncode != 0 and failures and all(any(needle in failure for failure in failures) for needle in expected))
            results.append({'case': name, 'expected': 'survives' if not expected else 'fails', 'exit': run.returncode, 'passed': payload['numPassedTests'], 'failed': payload['numFailedTests'], 'failedAssertions': failures, 'expectedOutcome': bool(correct)})
            print(name, 'expected' if correct else 'UNEXPECTED', flush=True)
            if not correct: raise AssertionError((name, failures))
finally:
    for path, raw in originals.items(): path.write_text(raw)
    (review / 'retirement-mutations.json').write_text(json.dumps({'cases': results, 'sourcesRestored': all(p.read_text() == raw for p, raw in originals.items()), 'sourceSha256': {str(p.relative_to(app)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, 'blindCategories': ['Mocked dependency refusal does not prove database isolation.', 'Page test asserts projections and props, not rendering of the mocked child.', 'Text and DOM checks do not prove visual layout or planner usefulness.', 'The write inventory sees static Supabase calls, not arbitrary hidden database clients.', 'The broad copy scanner misses text following inline JSX values. This disclosure has its own text paragraph; rendered panel assertions separately protect its meaning.']}, indent=2) + '\n')
