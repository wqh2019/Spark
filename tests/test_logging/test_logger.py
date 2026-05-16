# tests/test_logging/test_logger.py
import tempfile
from datetime import datetime
from pathlib import Path

from spark.logging import AgentLogger, TraceRecord


class TestAgentLogger:
    def test_create_logger_with_defaults(self):
        logger = AgentLogger()
        assert logger.enable_console is True
        assert logger.enable_file is False

    def test_create_logger_with_file_output(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            logger = AgentLogger(
                log_dir=Path(tmpdir),
                enable_console=False,
                enable_file=True,
            )
            logger.log(TraceRecord(
                trace_id="test",
                step=0,
                event_type="llm_start",
                timestamp=datetime(2024, 1, 15, 10, 30, 45),
                model="gpt-4",
            ))
            logger.close()

            files = list(Path(tmpdir).glob("spark-*.jsonl"))
            assert len(files) == 1

    def test_start_trace_returns_trace_id(self):
        logger = AgentLogger()
        trace_id = logger.start_trace()
        assert trace_id is not None
        assert len(trace_id) == 8

    def test_log_llm_call(self):
        logger = AgentLogger(enable_console=False, enable_file=False)
        logger.start_trace()
        logger.log_llm_start(step=0, model="gpt-4")
        logger.log_llm_end(
            step=0,
            model="gpt-4",
            prompt_tokens=100,
            completion_tokens=50,
            duration_ms=500,
        )
        # Check token usage was tracked
        assert logger.token_usage.total_prompt == 100
        assert logger.token_usage.total_completion == 50

    def test_log_tool_call(self):
        logger = AgentLogger(enable_console=False, enable_file=False)
        logger.start_trace()
        logger.log_tool_start(step=0, tool_name="search", tool_args={"q": "test"})
        logger.log_tool_end(step=0, tool_name="search", tool_result="ok")
