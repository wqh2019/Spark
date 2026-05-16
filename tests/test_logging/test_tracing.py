# tests/test_logging/test_tracing.py
import pytest
from datetime import datetime
from spark.logging.tracing import TraceRecord, TokenUsage


class TestTraceRecord:
    def test_create_llm_start_record(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 45),
            model="gpt-4",
        )
        assert record.trace_id == "abc123"
        assert record.step == 0
        assert record.event_type == "llm_start"
        assert record.model == "gpt-4"
        assert record.duration_ms is None
        assert record.prompt_tokens is None

    def test_create_llm_end_record(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="llm_end",
            timestamp=datetime(2024, 1, 15, 10, 30, 47),
            duration_ms=1200,
            prompt_tokens=150,
            completion_tokens=80,
        )
        assert record.event_type == "llm_end"
        assert record.duration_ms == 1200
        assert record.prompt_tokens == 150
        assert record.completion_tokens == 80

    def test_create_tool_record(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="tool_start",
            timestamp=datetime(2024, 1, 15, 10, 30, 47),
            tool_name="search",
            tool_args={"query": "weather"},
        )
        assert record.event_type == "tool_start"
        assert record.tool_name == "search"
        assert record.tool_args == {"query": "weather"}

    def test_create_error_record(self):
        record = TraceRecord(
            trace_id="abc123",
            step=0,
            event_type="tool_end",
            timestamp=datetime(2024, 1, 15, 10, 30, 48),
            tool_name="search",
            error="Connection timeout",
        )
        assert record.error == "Connection timeout"


class TestTokenUsage:
    def test_create_token_usage(self):
        usage = TokenUsage(
            total_prompt=150,
            total_completion=80,
        )
        assert usage.total_prompt == 150
        assert usage.total_completion == 80
        assert usage.by_model == {}

    def test_add_model_usage(self):
        usage = TokenUsage(total_prompt=0, total_completion=0)
        usage.add("gpt-4", prompt=150, completion=80)
        assert usage.total_prompt == 150
        assert usage.total_completion == 80
        assert usage.by_model["gpt-4"]["prompt"] == 150
        assert usage.by_model["gpt-4"]["completion"] == 80

    def test_total_tokens(self):
        usage = TokenUsage(total_prompt=150, total_completion=80)
        assert usage.total_tokens == 230
