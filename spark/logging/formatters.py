# spark/logging/formatters.py
"""Formatters for trace records."""
import json
from typing import Any

from spark.logging.tracing import TraceRecord


class TextFormatter:
    """Format trace records as human-readable text with colors."""

    # ANSI color codes
    COLORS = {
        "llm_start": "\033[94m",  # Blue
        "llm_end": "\033[92m",  # Green
        "tool_start": "\033[93m",  # Yellow
        "tool_end": "\033[93m",  # Yellow
        "error": "\033[91m",  # Red
        "reset": "\033[0m",
    }

    def format(self, record: TraceRecord) -> str:
        """Format a trace record as colored text."""
        ts = record.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        event = record.event_type.upper()
        color = self.COLORS.get(record.event_type, "")
        reset = self.COLORS["reset"] if color else ""

        parts = [f"{ts} [INFO] [trace={record.trace_id}] [step={record.step}]"]
        parts.append(f"{color}{event}{reset}")

        if record.model:
            parts.append(f"model={record.model}")

        if record.prompt_tokens is not None and record.completion_tokens is not None:
            parts.append(f"tokens={record.prompt_tokens}+{record.completion_tokens}")

        if record.duration_ms is not None:
            parts.append(f"duration={record.duration_ms}ms")

        if record.tool_name:
            parts.append(f"name={record.tool_name}")

        if record.tool_args:
            parts.append(f"args={json.dumps(record.tool_args, ensure_ascii=False)}")

        if record.tool_result:
            # Truncate long results
            result = (
                record.tool_result[:200] + "..."
                if len(record.tool_result) > 200
                else record.tool_result
            )
            parts.append(f"result={result}")

        if record.error:
            parts.append(f"error={record.error}")

        return " ".join(parts)


class JsonFormatter:
    """Format trace records as JSON lines."""

    def format(self, record: TraceRecord) -> str:
        """Format a trace record as JSON."""
        data: dict[str, Any] = {
            "trace_id": record.trace_id,
            "step": record.step,
            "event_type": record.event_type,
            "timestamp": record.timestamp.isoformat(),
        }

        if record.model is not None:
            data["model"] = record.model
        if record.duration_ms is not None:
            data["duration_ms"] = record.duration_ms
        if record.prompt_tokens is not None:
            data["prompt_tokens"] = record.prompt_tokens
        if record.completion_tokens is not None:
            data["completion_tokens"] = record.completion_tokens
        if record.tool_name is not None:
            data["tool_name"] = record.tool_name
        if record.tool_args is not None:
            data["tool_args"] = record.tool_args
        if record.tool_result is not None:
            data["tool_result"] = record.tool_result
        if record.error is not None:
            data["error"] = record.error

        return json.dumps(data, ensure_ascii=False)
