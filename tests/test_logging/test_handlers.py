# tests/test_logging/test_handlers.py
import json
import tempfile
from datetime import datetime
from pathlib import Path

from spark.logging.tracing import TraceRecord
from spark.logging.formatters import TextFormatter, JsonFormatter
from spark.logging.handlers import ConsoleHandler, FileHandler


class TestConsoleHandler:
    def test_emit_calls_formatter(self, capsys):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 45),
            model="gpt-4",
        )
        handler = ConsoleHandler(formatter=TextFormatter())
        handler.emit(record)
        captured = capsys.readouterr()
        assert "LLM_START" in captured.out


class TestFileHandler:
    def test_emit_writes_to_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            handler = FileHandler(
                log_dir=Path(tmpdir),
                formatter=JsonFormatter(),
            )
            record = TraceRecord(
                trace_id="abc123",
                step=0,
                event_type="llm_start",
                timestamp=datetime(2024, 1, 15, 10, 30, 45),
                model="gpt-4",
            )
            handler.emit(record)
            handler.close()

            # Check file exists
            files = list(Path(tmpdir).glob("spark-*.jsonl"))
            assert len(files) == 1

            # Check content
            content = files[0].read_text()
            data = json.loads(content.strip())
            assert data["trace_id"] == "abc123"

    def test_file_naming_by_date(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            handler = FileHandler(
                log_dir=Path(tmpdir),
                formatter=JsonFormatter(),
            )
            record = TraceRecord(
                trace_id="abc123",
                step=0,
                event_type="llm_start",
                timestamp=datetime(2024, 1, 15, 10, 30, 45),
                model="gpt-4",
            )
            handler.emit(record)
            handler.close()

            # File should be named by date
            files = list(Path(tmpdir).glob("spark-2024-01-15.jsonl"))
            assert len(files) == 1
