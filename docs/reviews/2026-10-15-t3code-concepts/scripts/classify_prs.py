"""Reproducible keyword/scope classification of every T3 Code PR in pull-requests.jsonl.

Run:  python3 -I scripts/classify_prs.py <research_dir>
Inputs: pull-requests.jsonl (title/body/state/labels collected by collect.py).
Outputs (evidence/): pr-classification.jsonl, pr-classification.tsv, pr-classification-summary.json

This is a metadata screen: it reads each PR's title, labels and the first 6,000
characters of its cleaned body. It is not a review of diffs or discussions.
Theme rules are deterministic regular expressions listed below; changing them
changes the output, so the rules are part of the evidence.
"""
import collections
import json
import re
import sys
from pathlib import Path

R = Path(sys.argv[1])
OUT = R / "evidence"
OUT.mkdir(exist_ok=True)

TITLE_RX = re.compile(r"^\s*(\[[^\]]*\]\s*)?([a-zA-Z]+)(\(([^)]*)\))?!?:\s*(.*)$")

# theme -> (OpenPlan relevance class, regex). Relevance classes:
#   A = maps to an existing or queued OpenPlan home (worth comparing)
#   B = transferable engineering/operations pattern (inspiration)
#   C = coding-IDE specific (terminal, git, editor); rarely transferable
THEMES = {
    "provider-integration": ("A", r"\b(codex|claude|opencode|open ?code|cursor[- ]agent|cursor sdk|grok|acp\b|antigravity|muse code|\bpi\b agent|provider (adapter|driver|instance)|app-server|agent sdk|provider[s]?\b)"),
    "provider-accounts-limits": ("A", r"(sign[- ]?in|log ?in\b|login|logout|sign[- ]?out|account[s]?\b|subscription|usage limit|rate[- ]limit|quota|reset time|chatgpt plan|api key|credential)"),
    "approvals-permissions": ("A", r"(approv|permission|runtime mode|full access|supervised|auto-accept|sandbox|allow once|deny|escalat)"),
    "durable-orchestration-recovery": ("A", r"(orchestrat|event[- ]sourc|outbox|command receipt|receipt|idempot|recover|restart continu|resume|reconcil|effect worker|projection|replay|crash|interrupt|durable|at-least-once|exactly-once|lease)"),
    "delegation-subagents-handoff": ("A", r"(subagent|sub-agent|delegat|child thread|task_status|delegate_task|fork|merge[- ]back|handoff|context transfer)"),
    "mcp-external-agents": ("A", r"(\bmcp\b|oauth|outside agent|model context protocol|tool call|toolkit)"),
    "scheduled-automation-webhooks": ("A", r"(schedul|cron|webhook|automation|recurring|watch_pull_request|wake)"),
    "notifications-mobile-offline": ("A", r"(notification|push\b|apns|fcm|live activit|live update|widget|offline|outbox queue|queued message)"),
    "observability-diagnostics": ("A", r"(trace|tracing|otel|opentelemetry|telemetry|metric|diagnostic|posthog|heap snapshot|event loop|stall|observab|log file|logging)"),
    "update-install-migration-rollback": ("A", r"(self-update|t3 update|update server|launcher|install(er|ation)?\b|rollback|roll back|migration|migrate|downgrade|release channel|nightly|service install|systemd|launchd)"),
    "data-portability-export-import": ("A", r"(export|import|backup|restore|portab|statev2|sqlite copy|recovery copy)"),
    "usage-cost-accounting": ("A", r"(usage page|\busage\b|cost|pricing|price|token (use|usage|count)|cache hit)"),
    "evidence-artifacts-rendering": ("A", r"(html render|visual repl|attachment|file preview|pdf|artifact|screenshot|snapshot|image|video|csv|mcp app)"),
    "citations-context-references": ("A", r"(citation|cite\b|quote|context chip|context reference|context record|mention|prompt link|t3-context)"),
    "collaboration-review": ("B", r"(pull request|\bpr\b|review guide|review comment|code review|viewed file|reviewer|stack(ed)?\b|merge queue|comment)"),
    "remote-access-connectivity": ("B", r"(remote|relay|tunnel|tailscale|\bssh\b|pairing|t3 connect|reconnect|dpop|connection|route[s]?\b|lan\b)"),
    "auth-security-hardening": ("A", r"(security|vulnerab|xss|csrf|injection|prompt injection|secret|redact|token|scope[s]?\b|authoriz|authenticat|invisible character|zero-width)"),
    "accessibility-i18n": ("A", r"(a11y|accessib|screen reader|aria|voiceover|keyboard focus|focus trap|i18n|locale|translation|rtl\b|contrast|reduced motion)"),
    "settings-config-layering": ("B", r"(settings?\b|override|inherit|project setting|environment default|preference|t3\.json)"),
    "performance-scaling": ("B", r"(perf\b|performance|memory|cpu|gpu|virtualiz|lag|jank|slow|latency|throughput|payload|bounded|pagination|paginat)"),
    "testing-verification": ("B", r"(test|fixture|replay fixture|e2e|regression|verif|smoke|canary|mutation)"),
    "docs-policy-process": ("B", r"(\bdocs?\b|documentation|contributing|triage|agents\.md|readme|policy|license|notice)"),
    "ui-workflow-general": ("C", r"(sidebar|composer|theme|keybinding|shortcut|command palette|thread list|snooze|settle|pin(ned)?\b|drag|toast|banner|modal|dialog)"),
    "source-control-git": ("C", r"(\bgit\b|worktree|branch|commit|checkpoint|diff|rebase|github|gitlab|bitbucket|forgejo|gitea|azure devops)"),
    "terminal-devices-browser": ("C", r"(terminal|\bpty\b|ghostty|device panel|simulator|emulator|browser panel|preview browser|headless (chrome|browser)|cua\b|snapshot capture|snap ?shot|wayland|hyprland|niri)"),
    "voice-input": ("C", r"(voice|dictat|transcri|microphone|speech)"),
    "desktop-native-packaging": ("C", r"(electron|desktop app|dmg|appimage|\.deb|nsis|winget|homebrew|aur\b|codesign|notariz)"),
    "marketing-site": ("C", r"(marketing|landing page|website copy)"),
}
COMPILED = {k: (v[0], re.compile(v[1], re.I)) for k, v in THEMES.items()}

SCOPE_HINTS = {
    "mcp": "mcp-external-agents", "usage": "usage-cost-accounting", "relay": "remote-access-connectivity",
    "connect": "remote-access-connectivity", "ssh": "remote-access-connectivity", "observability": "observability-diagnostics",
    "orchestrator": "durable-orchestration-recovery", "orchestration": "durable-orchestration-recovery",
    "orchestration-v2": "durable-orchestration-recovery", "v2": "durable-orchestration-recovery",
    "codex": "provider-integration", "claude": "provider-integration", "opencode": "provider-integration",
    "grok": "provider-integration", "acp": "provider-integration", "antigravity": "provider-integration",
    "cursor": "provider-integration", "pi": "provider-integration", "providers": "provider-integration",
    "provider": "provider-integration", "provider-core": "provider-integration", "provider-acp": "provider-integration",
    "provider-cursor": "provider-integration", "provider-muse": "provider-integration",
    "terminal": "terminal-devices-browser", "devices": "terminal-devices-browser", "cua": "terminal-devices-browser",
    "preview": "terminal-devices-browser", "git": "source-control-git", "vcs": "source-control-git",
    "source-control": "source-control-git", "pull-requests": "collaboration-review", "review": "collaboration-review",
    "github": "source-control-git", "keybindings": "ui-workflow-general", "sidebar": "ui-workflow-general",
    "composer": "ui-workflow-general", "voice": "voice-input", "marketing": "marketing-site", "release": "update-install-migration-rollback",
    "cli": "update-install-migration-rollback", "auth": "auth-security-hardening", "i18n": "accessibility-i18n",
    "settings": "settings-config-layering", "desktop": "desktop-native-packaging", "swift-ios": "notifications-mobile-offline",
    "mobile": "notifications-mobile-offline", "android": "notifications-mobile-offline", "ios": "notifications-mobile-offline",
}

COMMENT_RX = re.compile(r"<!--.*?-->", re.S)
IMG_RX = re.compile(r"!\[[^\]]*\]\([^)]*\)")
URL_RX = re.compile(r"https?://\S+")


def clean(body: str) -> str:
    body = COMMENT_RX.sub(" ", body or "")
    body = IMG_RX.sub(" ", body)
    body = URL_RX.sub(" ", body)
    return body[:6000]


def classify(r: dict) -> dict:
    title = r["title"] or ""
    m = TITLE_RX.match(title)
    ctype = (m.group(2).lower() if m else "untyped")
    scope = ((m.group(4) or "").lower() if m else "")
    body = clean(r["body"] or "")
    scores = {}
    for theme, (_, rx) in COMPILED.items():
        t_hits = len(rx.findall(title))
        b_hits = len(set(x if isinstance(x, str) else x[0] for x in rx.findall(body)))
        score = 3 * t_hits + min(b_hits, 4)
        if t_hits or b_hits >= 2:
            scores[theme] = score
    for s in re.split(r"[,/ ]+", scope):
        if s in SCOPE_HINTS:
            scores[SCOPE_HINTS[s]] = scores.get(SCOPE_HINTS[s], 0) + 4
    themes = sorted(scores, key=lambda k: -scores[k])
    primary = themes[0] if themes else "unclassified"
    rel = sorted({COMPILED[t][0] for t in themes}) or ["-"]
    size = next((l.split(":", 1)[1] for l in r["labels"] if l.startswith("size:")), "")
    status = "merged" if r["merged_at"] else ("open" if r["state"] == "open" else "closed-unmerged")
    return {
        "number": r["number"], "status": status, "draft": bool(r["draft"]), "type": ctype, "scope": scope,
        "size": size, "author": r["author"], "created": r["created_at"][:10],
        "primaryTheme": primary, "themes": themes[:6], "relevanceClasses": rel,
        "bestRelevance": rel[0] if rel != ["-"] else "-",
        "title": title.replace("\t", " ").replace("\n", " "), "url": r["html_url"],
    }


rows = [json.loads(l) for l in (R / "pull-requests.jsonl").open()]
out = [classify(r) for r in rows]
(OUT / "pr-classification.jsonl").write_text("".join(json.dumps(o, ensure_ascii=False) + "\n" for o in out))
cols = ["number", "status", "draft", "type", "scope", "size", "primaryTheme", "themes", "bestRelevance", "title", "url"]
(OUT / "pr-classification.tsv").write_text(
    "\t".join(cols) + "\n" + "".join("\t".join(",".join(o[c]) if isinstance(o[c], list) else str(o[c]) for c in cols) + "\n" for o in out))

summary = {
    "rules": {k: {"relevance": v[0], "regex": v[1]} for k, v in THEMES.items()},
    "totals": collections.Counter(o["status"] for o in out),
    "unclassified": sum(o["primaryTheme"] == "unclassified" for o in out),
    "primaryThemeByStatus": {},
    "anyThemeByStatus": {},
    "bestRelevanceByStatus": {},
    "typeByStatus": {},
}
for o in out:
    summary["primaryThemeByStatus"].setdefault(o["primaryTheme"], collections.Counter())[o["status"]] += 1
    for t in o["themes"]:
        summary["anyThemeByStatus"].setdefault(t, collections.Counter())[o["status"]] += 1
    summary["bestRelevanceByStatus"].setdefault(o["bestRelevance"], collections.Counter())[o["status"]] += 1
    summary["typeByStatus"].setdefault(o["type"], collections.Counter())[o["status"]] += 1
(OUT / "pr-classification-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({k: summary[k] for k in ("totals", "unclassified", "bestRelevanceByStatus")}, indent=1))
for t, c in sorted(summary["anyThemeByStatus"].items(), key=lambda kv: -sum(kv[1].values())):
    print(f"{t:38s} any={sum(c.values()):5d} merged={c['merged']:5d} open={c['open']:4d} closed={c['closed-unmerged']:5d}  primary={sum(summary['primaryThemeByStatus'].get(t, {}).values())}")
