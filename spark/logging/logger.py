# spark/logging/logger.py
"""Core AgentLogger class for tracing agent execution."""
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from spark.logging.formatters import JsonFormatter, TextFormatter
from spark.logging.handlers import ConsoleHandler, FileHandler
from spark.logging.tracing import TokenUsage, TraceRecord


@dataclass
class LoggerConfig:
    """Configuration for AgentLogger."""
    enable_console: bool = True
    enable_file: bool = False
    log_dir: Path = Path("./logs")
    retention_days: int = 7


class AgentLogger:
    """
    Logger for tracing agent execution and token usage.

    Usage:
        logger = AgentLogger(log_dir=Path("./logs"), enable_file=True)
        trace_id = logger.start_trace()
        logger.log_llm_start(step=0, model="gpt-4")
        # ... LLM call ...
        logger.log_llm_end(step=0, model="gpt-4", prompt_tokens=100, completion_tokens=50)
        logger.end_trace()
    """

    def __init__(
        self,
        enable_console: bool = True,
        enable_file: bool = False,
        log_dir: Path | str = Path("./logs"),
        retention_days: int = 7,
    ):
        self.enable_console = enable_console
        self.enable_file = enable_file
        self.log_dir = Path(log_dir) if isinstance(log_dir, str) else log_dir
        self.retention_days = retention_days

        self._trace_id: str | None = None
        self._start_time: float | None = None
        self.token_usage = TokenUsage(total_prompt=0, total_completion=0)

        self._handlers: list[Any] = []

        if enable_console:
            self._handlers.append(ConsoleHandler(TextFormatter()))
        if enable_file:
            self._handlers.append(FileHandler(self.log_dir, JsonFormatter(), retention_days))

    def start_trace(self) -> str:
        """Start a new trace and return its ID."""
        self._trace_id = uuid.uuid4().hex[:8]
        self._start_time = time.time()
        self.token_usage = TokenUsage(total_prompt=0, total_completion=0)
        return self._trace_id

    def end_trace(self) -> None:
        """End the current trace and write a summary record."""
        if self._trace_id is not None and self._start_time is not None:
            duration_ms = int((time.time() - self._start_time) * 1000)
            record = TraceRecord(
                trace_id=self._trace_id,
                step=-1,
                event_type="trace_summary",
                timestamp=datetime.now(),
                duration_ms=duration_ms,
                prompt_tokens=self.token_usage.total_prompt,
                completion_tokens=self.token_usage.total_completion,
                by_model=self.token_usage.by_model if self.token_usage.by_model else None,
            )
            self.log(record)
        self._trace_id = None
        self._start_time = None

    def log(self, record: TraceRecord) -> None:
        """Log a trace record to all handlers and broadcast to admin clients."""
        for handler in self._handlers:
            handler.emit(record)
        # Broadcast to admin SSE clients
        try:
            from spark.server.log_broadcaster import broadcaster
            from spark.logging.formatters import JsonFormatter
            import json
            data = json.loads(JsonFormatter().format(record))
            broadcaster.broadcast(data)
        except Exception:
            pass  # Don't let broadcast errors break logging

    def log_llm_start(self, step: int, model: str) -> None:
        """Log the start of an LLM call."""
        record = TraceRecord(
            trace_id=self._trace_id or "unknown",
            step=step,
            event_type="llm_start",
            timestamp=datetime.now(),
            model=model,
        )
        self.log(record)

    def log_llm_end(
        self,
        step: int,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        duration_ms: int,
    ) -> None:
        """Log the end of an LLM call."""
        self.token_usage.add(model, prompt_tokens, completion_tokens)

        record = TraceRecord(
            trace_id=self._trace_id or "unknown",
            step=step,
            event_type="llm_end",
            timestamp=datetime.now(),
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            duration_ms=duration_ms,
        )
        self.log(record)

    def log_tool_start(self, step: int, tool_name: str, tool_args: dict[str, Any]) -> None:
        """Log the start of a tool execution."""
        record = TraceRecord(
            trace_id=self._trace_id or "unknown",
            step=step,
            event_type="tool_start",
            timestamp=datetime.now(),
            tool_name=tool_name,
            tool_args=tool_args,
        )
        self.log(record)

    def log_tool_end(
        self,
        step: int,
        tool_name: str,
        tool_result: str | None = None,
        error: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Log the end of a tool execution."""
        record = TraceRecord(
            trace_id=self._trace_id or "unknown",
            step=step,
            event_type="tool_end",
            timestamp=datetime.now(),
            tool_name=tool_name,
            tool_result=tool_result,
            error=error,
            duration_ms=duration_ms,
        )
        self.log(record)

    def close(self) -> None:
        """Close all handlers."""
        for handler in self._handlers:
            handler.close()
