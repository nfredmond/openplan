"""Read or temporarily mutate the actual migration section under test.

Review candidates remain historical snapshots. Probe mutations preserve the
other section and always restore their own original text in a finally block.
"""
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[3] / "openplan/supabase/migrations/20261014000013_engagement_translation_generation.sql"

class GenerationSection:
    def __init__(self, kind: str):
        if kind not in ("queue", "output"):
            raise ValueError("Unknown generation migration section")
        self.begin = "-- BEGIN TRANSLATION_GENERATION_" + kind.upper() + "\n"
        self.end = "-- END TRANSLATION_GENERATION_" + kind.upper() + "\n"

    def bounds(self, text: str) -> tuple[int, int]:
        if text.count(self.begin) != 1 or text.count(self.end) != 1:
            raise ValueError("Generation migration markers are missing or ambiguous")
        start = text.index(self.begin) + len(self.begin)
        end = text.index(self.end, start)
        return start, end

    def read_text(self) -> str:
        text = MIGRATION.read_text()
        start, end = self.bounds(text)
        return text[start:end]

    def read_bytes(self) -> bytes:
        return self.read_text().encode()

    def write_text(self, value: str) -> None:
        text = MIGRATION.read_text()
        start, end = self.bounds(text)
        MIGRATION.write_text(text[:start] + value + text[end:])
