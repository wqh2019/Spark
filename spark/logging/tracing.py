# spark/logging/tracing.py
"""Data structures for tracing agent execution."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class TraceRecord:
    """A single trace record for an agent operation."""
    trace_id: str
    step: int
    event_type: str  # "llm_start" | "llm_end" | "tool_start" | "tool_end"
    timestamp: datetime
    duration_ms: int | None = None

    # LLM related
    model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None

    # Tool related
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_result: str | None = None

    # Error
    error: str | None = None

    # Trace summary (trace_summary 事件使用)
    by_model: dict[str, dict[str, int]] | None = None


@dataclass
class TokenUsage:
    """Token usage statistics."""
    total_prompt: int
    total_completion: int
    by_model: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.total_prompt + self.total_completion

    def add(self, model: str, prompt: int, completion: int) -> None:
        """Add token usage for a model."""
        self.total_prompt += prompt
        self.total_completion += completion
        if model not in self.by_model:
            self.by_model[model] = {"prompt": 0, "completion": 0}
        self.by_model[model]["prompt"] += prompt
        self.by_model[model]["completion"] += completion
