# spark/logging/handlers.py
"""Handlers for outputting trace records."""
import time
from pathlib import Path
from typing import Protocol

from spark.logging.tracing import TraceRecord


class FormatterProtocol(Protocol):
    def format(self, record: TraceRecord) -> str: ...


class ConsoleHandler:
    """Output trace records to console."""

    def __init__(self, formatter: FormatterProtocol):
        self.formatter = formatter

    def emit(self, record: TraceRecord) -> None:
        """Write a trace record to stdout."""
        print(self.formatter.format(record))

    def close(self) -> None:
        """Close the handler (no-op for console)."""
        pass


class FileHandler:
    """Output trace records to file with daily rotation."""

    def __init__(
        self,
        log_dir: Path,
        formatter: FormatterProtocol,
        retention_days: int = 7,
    ):
        self.log_dir = Path(log_dir)
        self.formatter = formatter
        self.retention_days = retention_days
        self._current_file: Path | None = None
        self._current_date: str | None = None

        self.log_dir.mkdir(parents=True, exist_ok=True)

    def emit(self, record: TraceRecord) -> None:
        """Write a trace record to file."""
        date_str = record.timestamp.strftime("%Y-%m-%d")

        # Check if we need to rotate to a new file
        if self._current_date != date_str:
            self._current_date = date_str
            self._current_file = self.log_dir / f"spark-{date_str}.jsonl"
            self._cleanup_old_files()

        if self._current_file is None:
            raise RuntimeError("Handler not properly initialized")
        with open(self._current_file, "a", encoding="utf-8") as f:
            f.write(self.formatter.format(record) + "\n")

    def close(self) -> None:
        """Close the handler."""
        self._current_file = None
        self._current_date = None

    def _cleanup_old_files(self) -> None:
        """Remove log files older than retention_days."""
        if self.retention_days <= 0:
            return

        cutoff = time.time() - self.retention_days * 24 * 60 * 60

        for file in self.log_dir.glob("spark-*.jsonl"):
            if file.stat().st_mtime < cutoff:
                file.unlink()
