"""List PRs whose TITLE matches focused OpenPlan-comparison patterns (stricter than body screen).
Run: python3 -I scripts/title_hits.py <research_dir>  -> evidence/title-hits/<theme>.tsv"""
import json, re, sys
from pathlib import Path
R = Path(sys.argv[1]); D = R / 'evidence' / 'title-hits'; D.mkdir(parents=True, exist_ok=True)
F = {
 'approval': r'approv|permission|runtime mode|full access|supervised|sandbox|escalat|auto-accept|ceiling',
 'recovery-durability': r'recover|restart|resume|reconcil|idempot|receipt|outbox|durab|crash|replay|lease|duplicate|exactly|at-least|lost|orphan|interrupted',
 'delegation-handoff': r'subagent|sub-agent|delegat|handoff|hand-off|fork|merge-back|merge back|context transfer|child thread',
 'mcp-oauth': r'\bmcp\b|oauth|outside agent',
 'schedule-webhook-watch': r'schedul|cron|webhook|automation|recurring|watch',
 'notifications-mobile-offline': r'notif|push|live activit|live update|widget|offline|outbox',
 'observability': r'trace|telemetry|otel|otlp|metric|diagnost|observab|stall|heap|log\b|logs\b|logging|health',
 'update-migration-rollback': r'update|upgrade|rollback|roll back|migrat|downgrade|launcher|install|uninstall|version',
 'export-import-backup': r'export|import|backup|restore|portab',
 'usage-limits-cost': r'usage|limit|quota|cost|price|pricing|token',
 'citation-context-prompt': r'citation|cite|quote|context|mention|prompt link|reference',
 'security-injection': r'secur|xss|csrf|inject|secret|redact|credential|invisible|zero-width|sanitiz|leak|vulnerab|ssrf|traversal',
 'accessibility-i18n': r'a11y|accessib|screen reader|aria|voiceover|focus|i18n|locale|translat|contrast|reduced motion|keyboard',
 'settings-layering': r'setting|override|inherit|default',
 'artifacts-rendering': r'html|render|visual|attachment|pdf|artifact|report|csv|preview|mcp app|chart',
 'review-collab': r'review|comment|viewed|guide|stack|reviewer',
 'provider-account': r'sign[- ]?in|login|logout|sign[- ]?out|account|subscription|api key|auth\b|authent',
 'queue-steer': r'queue|steer|follow-up|follow up',
 'question-input': r'question|ask|answer|user input|elicit|secret request',
 'plan-mode': r'\bplan\b|plans\b|todo|goal',
 'snooze-settle-inbox': r'snooze|settle|inbox|archive|pin\b|unread|read receipt',
 'model-catalog-capabilities': r'capabilit|model manifest|catalog|model list|unsupported',
}
rows = [json.loads(l) for l in (R/'evidence'/'pr-classification.jsonl').open()]
for k, pat in F.items():
    rx = re.compile(pat, re.I)
    hits = [r for r in rows if rx.search(r['title'])]
    (D/f'{k}.tsv').write_text(''.join(f"{r['number']}\t{r['status']}\t{r['size']}\t{r['title']}\n" for r in hits))
    c = {s: sum(h['status']==s for h in hits) for s in ('merged','open','closed-unmerged')}
    print(f'{k:30s} {len(hits):5d} {c}')
