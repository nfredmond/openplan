"""Split SQL into top-level statements the way psql sends them, and refuse
statements the install kit must never run.

The lexer understands line and nested block comments, standard and E''
strings, quoted identifiers, dollar quotes with tags, and parentheses. A
semicolon ends a statement only at the top level, outside all of those, as in
psql. Text inside a function body ($$ ... $$) is never read as a statement,
so the PL/pgSQL BEGIN and END in every DO block pass.

Why it matters (review 15, B2): run_sql.py sends each transaction as one
message from BEGIN through COMMIT or the dry run's raise, and the lexer
decides where psql joins the statements. A top-level COMMIT, END or ROLLBACK
inside that message commits everything before it, and the statements after it
run in a new implicit block (PostgreSQL 17 protocol 53.2.2.1). One stray
transaction-control statement would turn the rollback-only dry run into a
partial install. The transaction guard after each statement is the second
layer; it stops what follows such a statement, not what came before it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


class SqlRefused(Exception):
    """The SQL holds a statement the kit will not send. The message names it."""


@dataclass(frozen=True)
class Statement:
    text: str          # from the first character to the terminating semicolon, inclusive
    start: int         # offset in the source
    end: int           # offset just past the semicolon (or end of text)
    line: int          # 1-based line of the first keyword
    words: tuple[str, ...]  # top-level keywords and identifiers, upper case, in order
    terminated: bool   # ended with a top-level semicolon
    all_words: tuple[str, ...] = ()  # the same at every parenthesis depth

    @property
    def first(self) -> str:
        return self.words[0] if self.words else ""

    def starts_with(self, *keywords: str) -> bool:
        return self.words[: len(keywords)] == tuple(keywords)


# PostgreSQL's scanner (scan.l) and psql's (psqlscan.l) treat every byte from
# 0x80 up as an identifier character, so every non-ASCII character, including
# one above U+FFFF, belongs to the identifier around it. A narrower range let a
# character above U+FFFF end an identifier early, so "k<emoji>$a$" read as the
# start of a dollar quote that hid a top-level COMMIT (review 31, N1).
_IDENT_START = re.compile(r"[A-Za-z_\u0080-\U0010FFFF]")
_IDENT_CHAR = re.compile(r"[A-Za-z0-9_$\u0080-\U0010FFFF]")
_DOLLAR_TAG = re.compile(r"\$([A-Za-z_\u0080-\U0010FFFF][A-Za-z0-9_\u0080-\U0010FFFF]*)?\$")


@dataclass
class _Scan:
    statements: list[Statement] = field(default_factory=list)
    backslash_at: list[int] = field(default_factory=list)


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def split_statements(sql: str) -> list[Statement]:
    """Top-level statements in order. Whitespace and comments between them are skipped.

    Raises SqlRefused for an unterminated quote, comment or dollar quote, and for
    a backslash outside quotes and comments (a psql meta-command).
    """
    scan = _Scan()
    i, n = 0, len(sql)
    depth = 0
    stmt_start: int | None = None
    words: list[str] = []
    all_words: list[str] = []
    first_word_at: int | None = None

    def begin_statement(at: int) -> None:
        nonlocal stmt_start
        if stmt_start is None:
            stmt_start = at

    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch.isspace():
            i += 1
            continue
        if ch == "-" and nxt == "-":
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if ch == "/" and nxt == "*":
            level, j = 1, i + 2
            while j < n and level:
                if sql.startswith("/*", j):
                    level += 1
                    j += 2
                elif sql.startswith("*/", j):
                    level -= 1
                    j += 2
                else:
                    j += 1
            if level:
                raise SqlRefused(f"unterminated block comment at line {_line_of(sql, i)}")
            i = j
            continue
        begin_statement(i)
        if ch == "'" or (ch in "eE" and nxt == "'" and not _prev_is_ident(sql, i)):
            escapes = ch in "eE"
            j = i + (2 if escapes else 1)
            while True:
                if j >= n:
                    raise SqlRefused(f"unterminated string at line {_line_of(sql, i)}")
                c = sql[j]
                if escapes and c == "\\":
                    j += 2
                    continue
                if c == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            i = j
            continue
        if ch == '"':
            j = i + 1
            while True:
                k = sql.find('"', j)
                if k < 0:
                    raise SqlRefused(f"unterminated quoted identifier at line {_line_of(sql, i)}")
                if k + 1 < n and sql[k + 1] == '"':
                    j = k + 2
                    continue
                # A quoted name still counts as a word, so "statement_timeout"
                # cannot slip past the settings check by being quoted.
                word = sql[i + 1:k].replace('""', '"').upper()
                all_words.append(word)
                if depth == 0:
                    if first_word_at is None:
                        first_word_at = i
                    words.append(word)
                i = k + 1
                break
            continue
        if ch == "$" and not _prev_is_ident(sql, i):
            m = _DOLLAR_TAG.match(sql, i)
            if m:
                tag = m.group(0)
                k = sql.find(tag, m.end())
                if k < 0:
                    raise SqlRefused(f"unterminated dollar quote {tag} at line {_line_of(sql, i)}")
                i = k + len(tag)
                continue
        if ch == "\\":
            raise SqlRefused(f"psql meta-command (backslash) at line {_line_of(sql, i)}")
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if ch == ";" and depth == 0:
            assert stmt_start is not None
            scan.statements.append(Statement(
                text=sql[stmt_start:i + 1], start=stmt_start, end=i + 1,
                line=_line_of(sql, first_word_at if first_word_at is not None else stmt_start),
                words=tuple(words), terminated=True, all_words=tuple(all_words)))
            stmt_start, words, all_words, first_word_at = None, [], [], None
            i += 1
            continue
        if _IDENT_START.match(ch):
            j = i + 1
            while j < n and _IDENT_CHAR.match(sql[j]):
                j += 1
            all_words.append(sql[i:j].upper())
            if depth == 0:
                if first_word_at is None:
                    first_word_at = i
                words.append(sql[i:j].upper())
            i = j
            continue
        i += 1

    if stmt_start is not None:
        scan.statements.append(Statement(
            text=sql[stmt_start:], start=stmt_start, end=n,
            line=_line_of(sql, first_word_at if first_word_at is not None else stmt_start),
            words=tuple(words), terminated=False, all_words=tuple(all_words)))
    return scan.statements


def _prev_is_ident(sql: str, i: int) -> bool:
    return i > 0 and bool(_IDENT_CHAR.match(sql[i - 1]))


# First keywords (or keyword pairs) that control the transaction. Any one of
# them at the top level ends or splits the install transaction.
_TRANSACTION_CONTROL = {"BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT",
                        "SAVEPOINT", "RELEASE"}
# Statements that cannot run in a transaction block, or that change the server
# or session outside the install's control.
_REFUSED_PAIRS = {("ALTER", "SYSTEM"), ("CREATE", "DATABASE"),
                  ("DROP", "DATABASE"), ("ALTER", "DATABASE"),
                  ("CREATE", "TABLESPACE"), ("DROP", "TABLESPACE")}
_REFUSED_FIRST = {"VACUUM", "DISCARD", "CHECKPOINT", "LISTEN", "UNLISTEN", "LOAD", "REINDEX"}
# The kit sets these itself. A file may not loosen them or carry a session-wide
# search_path into the next file.
_KIT_SETTINGS = {"LOCK_TIMEOUT", "STATEMENT_TIMEOUT", "IDLE_IN_TRANSACTION_SESSION_TIMEOUT",
                 "TRANSACTION_TIMEOUT", "SEARCH_PATH"}
# SET or RESET of these changes who runs the rest of the transaction, or how.
_SESSION_NAMES = {"ROLE", "SESSION", "AUTHORIZATION", "TRANSACTION", "ALL"}


def setting_name(stmt: Statement) -> str:
    """The setting a SET or RESET statement names, skipping LOCAL or SESSION."""
    rest = stmt.words[1:]
    if rest and rest[0] in {"LOCAL", "SESSION"} and len(rest) > 1 and rest[1] not in {"AUTHORIZATION", "CHARACTERISTICS"}:
        rest = rest[1:]
    return rest[0] if rest else ""


def refusal(stmt: Statement) -> str | None:
    """Why this top-level statement may not appear in a migration body, or None."""
    w = stmt.words
    if not w:
        return None
    if w[0] in _TRANSACTION_CONTROL:
        return "transaction control"
    if w[:2] == ("PREPARE", "TRANSACTION"):
        return "transaction control"
    if w[:2] in _REFUSED_PAIRS:
        return "session or server control"
    if w[0] in _REFUSED_FIRST:
        return "cannot run inside the install transaction"
    if any(w[k] == "BEGIN" and w[k + 1] == "ATOMIC" for k in range(len(w) - 1)):
        return "BEGIN ATOMIC body (the kit cannot split it safely)"
    if "CONCURRENTLY" in stmt.all_words:
        return "CONCURRENTLY cannot run inside a transaction"
    if w[0] == "COPY" and any(x in stmt.all_words for x in ("STDIN", "PROGRAM", "STDOUT")):
        return "COPY through the client or a program"
    if w[0] in {"SET", "RESET"}:
        name = setting_name(stmt)
        if name in _SESSION_NAMES:
            return "changes the role, session or transaction"
        if name in _KIT_SETTINGS:
            return f"changes {name.lower()}, which the kit sets"
    return None


@dataclass(frozen=True)
class PreparedBody:
    """A migration file ready for the install: its statements and how it was changed."""
    statements: tuple[Statement, ...]
    stripped_wrapper: bool


def prepare_migration(sql: str, *, self_wrapped: bool, label: str) -> PreparedBody:
    """Check one migration file and drop its own BEGIN; ... COMMIT; wrapper.

    self_wrapped comes from the reviewed window plan. A file that is wrapped
    when the plan says it is not, or the reverse, is refused, as is every other
    transaction-control or session-control statement at the top level.
    """
    stmts = split_statements(sql)
    if not stmts:
        raise SqlRefused(f"{label}: no statements")
    if not stmts[-1].terminated:
        raise SqlRefused(f"{label}: last statement at line {stmts[-1].line} has no semicolon")
    wrapped = (stmts[0].words in {("BEGIN",), ("BEGIN", "TRANSACTION"), ("BEGIN", "WORK")}
               and stmts[-1].words in {("COMMIT",), ("COMMIT", "TRANSACTION"), ("COMMIT", "WORK"), ("END",)})
    if wrapped != self_wrapped:
        state = "wraps itself in BEGIN/COMMIT" if wrapped else "does not wrap itself in BEGIN/COMMIT"
        raise SqlRefused(f"{label}: file {state}, but the plan says selfWrapped={self_wrapped}")
    body = stmts[1:-1] if wrapped else stmts
    for stmt in body:
        reason = refusal(stmt)
        if reason:
            raise SqlRefused(f"{label}: line {stmt.line}: {' '.join(stmt.words[:3])}: {reason}")
    return PreparedBody(statements=tuple(body), stripped_wrapper=wrapped)


# Read mode: only statements that return rows. The transaction is also READ
# ONLY, so a data-modifying CTE or a writing function still fails in the
# database; this check is the first of two layers.
_READ_FIRST = {"SELECT", "WITH", "SHOW", "TABLE", "VALUES"}


def check_read_only(sql: str, *, label: str) -> list[Statement]:
    stmts = split_statements(sql)
    if not stmts:
        raise SqlRefused(f"{label}: no statements")
    for stmt in stmts:
        if stmt.first not in _READ_FIRST:
            raise SqlRefused(f"{label}: line {stmt.line}: {stmt.first or 'statement'} is not allowed in read mode")
        if stmt.first == "WITH" and any(w in stmt.all_words for w in ("INSERT", "UPDATE", "DELETE", "MERGE")):
            raise SqlRefused(f"{label}: line {stmt.line}: data-modifying WITH is not allowed in read mode")
        if stmt.first == "SELECT" and "INTO" in stmt.words:
            raise SqlRefused(f"{label}: line {stmt.line}: SELECT INTO creates a table")
    return stmts


# Probe mode (review 15, N8): a packet's rolled-back probe. It may change rows
# and switch role to test a boundary, but must end in ROLLBACK and hold no other
# transaction control. The kit replaces the final ROLLBACK with a raise, so the
# probe cannot commit even if that statement were lost.
def prepare_probe(sql: str, *, label: str) -> list[Statement]:
    stmts = split_statements(sql)
    if not stmts or stmts[-1].words != ("ROLLBACK",) or not stmts[-1].terminated:
        raise SqlRefused(f"{label}: a probe must end with ROLLBACK;")
    body = stmts[:-1]
    for stmt in body:
        # A probe may switch role and set request claims for its own
        # transaction, as the October boundary probes did. Nothing else changes.
        if stmt.words[:2] == ("SET", "LOCAL") and setting_name(stmt) not in _KIT_SETTINGS | {"SESSION", "AUTHORIZATION", "TRANSACTION", "ALL"}:
            continue
        if stmt.words[:2] == ("RESET", "ROLE"):
            continue
        reason = refusal(stmt)
        if reason:
            raise SqlRefused(f"{label}: line {stmt.line}: {' '.join(stmt.words[:3])}: {reason}")
    return body
