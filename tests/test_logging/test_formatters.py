# tests/test_logging/test_formatters.py
from datetime import datetime

from spark.logging.formatters import JsonFormatter, TextFormatter
from spark.logging.tracing import TraceRecord


class TestTextFormatter:
    def test_format_llm_start(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 45),
            model="gpt-4",
        )
        formatter = TextFormatter()
        result = formatter.format(record)
        assert "2024-01-15 10:30:45" in result
        assert "[trace=abc123]" in result
        assert "[step=0]" in result
        assert "LLM_START" in result
        assert "model=gpt-4" in result

    def test_format_llm_end_with_tokens(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_end",
            timestamp=datetime(2024, 1, 15, 10, 30, 47),
            duration_ms=1200,
            prompt_tokens=150,
            completion_tokens=80,
        )
        formatter = TextFormatter()
        result = formatter.format(record)
        assert "LLM_END" in result
        assert "tokens=150+80" in result
        assert "duration=1200ms" in result

    def test_format_tool_start(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="tool_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 47),
            tool_name="search",
            tool_args={"query": "weather"},
        )
        formatter = TextFormatter()
        result = formatter.format(record)
        assert "TOOL_START" in result
        assert "name=search" in result
        assert '{"query": "weather"}' in result


class TestJsonFormatter:
    def test_format_returns_valid_json(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 45),
            model="gpt-4",
        )
        formatter = JsonFormatter()
        result = formatter.format(record)
        import json

        data = json.loads(result)
        assert data["trace_id"] == "abc123"
        assert data["step"] == 0
        assert data["event_type"] == "llm_start"
        assert data["model"] == "gpt-4"

    def test_format_excludes_none_values(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 45),
            model="gpt-4",
        )
        formatter = JsonFormatter()
        result = formatter.format(record)
        import json

        data = json.loads(result)
        assert "duration_ms" not in data
        assert "tool_name" not in data
