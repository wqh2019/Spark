"""Log data reading service for admin dashboard.

Reads JSONL log files, groups by trace, aggregates token usage, and provides caching.
"""

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


@dataclass
class TraceInfo:
    """Summary of a single trace."""
    trace_id: str
    started_at: datetime | None
    ended_at: datetime | None
    duration_ms: int | None
    total_prompt_tokens: int
    total_completion_tokens: int
    step_count: int
    models: list[str]
    tools_used: list[str]
    has_errors: bool
    events: list[dict]


@dataclass
class TokenUsageSummary:
    """Token usage aggregated across traces."""
    total_prompt: int
    total_completion: int
    total_tokens: int
    by_model: dict[str, dict[str, int]]
    trace_count: int


@dataclass
class TrendPoint:
    """A single point in a token usage time series."""
    timestamp: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    trace_count: int


class LogService:
    """Read and aggregate JSONL log data for the admin dashboard."""

    def __init__(self, log_dir: Path | str = Path("./logs"), cache_ttl: float = 30.0):
        self.log_dir = Path(log_dir) if isinstance(log_dir, str) else log_dir
        self.cache_ttl = cache_ttl
        self._cache: dict[str, tuple[float, list[dict]]] = {}

    # ── Low-level parsing ──────────────────────────────────────────

    def _read_jsonl_file(self, file_path: Path) -> list[dict]:
        """Read and parse a single JSONL file (with caching)."""
        key = str(file_path)
        now = datetime.now().timestamp()

        # Check cache
        if key in self._cache:
            cached_time, cached_data = self._cache[key]
            # Non-today files: cache indefinitely (content won't change)
            mtime = file_path.stat().st_mtime
            if file_path.stat().st_mtime < cached_time or (now - cached_time) < self.cache_ttl:
                if mtime <= file_path.stat().st_mtime:
                    return cached_data

        # Cache miss or expired — re-read
        records: list[dict] = []
        if not file_path.exists():
            return records

        mtime = file_path.stat().st_mtime
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        self._cache[key] = (now, records)
        return records

    def _read_all_records(self, date_from: str | None = None, date_to: str | None = None) -> list[dict]:
        """Read records from all JSONL files, optionally filtered by date range."""
        if not self.log_dir.exists():
            return []

        all_records: list[dict] = []
        for file_path in sorted(self.log_dir.glob("spark-*.jsonl")):
            # Extract date from filename: spark-2026-05-16.jsonl
            date_str = file_path.stem.replace("spark-", "")
            if date_from and date_str < date_from:
                continue
            if date_to and date_str > date_to:
                continue
            all_records.extend(self._read_jsonl_file(file_path))

        return all_records

    # ── Trace operations ───────────────────────────────────────────

    def _group_by_trace(self, records: list[dict]) -> dict[str, list[dict]]:
        """Group records by trace_id."""
        traces: dict[str, list[dict]] = {}
        for rec in records:
            tid = rec.get("trace_id", "unknown")
            traces.setdefault(tid, []).append(rec)
        return traces

    def _build_trace_info(self, trace_id: str, events: list[dict]) -> TraceInfo:
        """Build a TraceInfo from a list of event records."""
        # Sort events by step
        events_sorted = sorted(events, key=lambda e: e.get("step", 0))

        started_at = None
        ended_at = None
        duration_ms = None
        total_prompt = 0
        total_completion = 0
        models: set[str] = set()
        tools: set[str] = set()
        has_errors = False

        # Prefer trace_summary for token totals
        summary = next((e for e in events_sorted if e.get("event_type") == "trace_summary"), None)

        for e in events_sorted:
            et = e.get("event_type", "")

            # Timestamps
            ts = e.get("timestamp")
            if ts:
                try:
                    dt = datetime.fromisoformat(ts)
                    if started_at is None or dt < started_at:
                        started_at = dt
                    if ended_at is None or dt > ended_at:
                        ended_at = dt
                except (ValueError, TypeError):
                    pass

            if et == "trace_summary":
                duration_ms = e.get("duration_ms")
                total_prompt = e.get("prompt_tokens", 0) or 0
                total_completion = e.get("completion_tokens", 0) or 0
                if e.get("by_model"):
                    for model_name in e["by_model"]:
                        models.add(model_name)
            elif et == "llm_start":
                if e.get("model"):
                    models.add(e["model"])
            elif et == "llm_end":
                if e.get("model"):
                    models.add(e["model"])
                # Fallback token aggregation if no summary
                if summary is None:
                    total_prompt += e.get("prompt_tokens", 0) or 0
                    total_completion += e.get("completion_tokens", 0) or 0
            elif et == "tool_start":
                if e.get("tool_name"):
                    tools.add(e["tool_name"])
            elif et == "tool_end":
                if e.get("tool_name"):
                    tools.add(e["tool_name"])
                if e.get("error"):
                    has_errors = True

            if e.get("error"):
                has_errors = True

        # Step count = number of unique steps (exclude step=-1 from summary)
        step_count = len({e.get("step") for e in events_sorted if e.get("step", -1) >= 0})

        return TraceInfo(
            trace_id=trace_id,
            started_at=started_at,
            ended_at=ended_at,
            duration_ms=duration_ms,
            total_prompt_tokens=total_prompt,
            total_completion_tokens=total_completion,
            step_count=step_count,
            models=sorted(models),
            tools_used=sorted(tools),
            has_errors=has_errors,
            events=events_sorted,
        )

    def list_traces(
        self,
        page: int = 1,
        page_size: int = 20,
        model: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        has_errors: bool | None = None,
    ) -> tuple[list[dict], int]:
        """List traces with pagination and filtering. Returns (traces, total_count)."""
        records = self._read_all_records(date_from, date_to)
        grouped = self._group_by_trace(records)

        traces: list[TraceInfo] = []
        for tid, events in grouped.items():
            info = self._build_trace_info(tid, events)

            # Apply filters
            if model and model not in info.models:
                continue
            if has_errors is not None and info.has_errors != has_errors:
                continue

            traces.append(info)

        # Sort by started_at descending
        traces.sort(key=lambda t: t.started_at or datetime.min, reverse=True)

        total = len(traces)
        start = (page - 1) * page_size
        page_traces = traces[start:start + page_size]

        result = []
        for t in page_traces:
            result.append({
                "trace_id": t.trace_id,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "ended_at": t.ended_at.isoformat() if t.ended_at else None,
                "duration_ms": t.duration_ms,
                "total_prompt_tokens": t.total_prompt_tokens,
                "total_completion_tokens": t.total_completion_tokens,
                "step_count": t.step_count,
                "models": t.models,
                "tools_used": t.tools_used,
                "has_errors": t.has_errors,
            })

        return result, total

    def get_trace(self, trace_id: str) -> dict | None:
        """Get a single trace with all events."""
        records = self._read_all_records()
        grouped = self._group_by_trace(records)

        if trace_id not in grouped:
            return None

        info = self._build_trace_info(trace_id, grouped[trace_id])
        return {
            "trace_id": info.trace_id,
            "started_at": info.started_at.isoformat() if info.started_at else None,
            "ended_at": info.ended_at.isoformat() if info.ended_at else None,
            "duration_ms": info.duration_ms,
            "total_prompt_tokens": info.total_prompt_tokens,
            "total_completion_tokens": info.total_completion_tokens,
            "step_count": info.step_count,
            "models": info.models,
            "tools_used": info.tools_used,
            "has_errors": info.has_errors,
            "events": info.events,
        }

    # ── Token aggregation ──────────────────────────────────────────

    def get_token_usage(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
        model: str | None = None,
    ) -> TokenUsageSummary:
        """Get aggregated token usage across all traces."""
        records = self._read_all_records(date_from, date_to)
        grouped = self._group_by_trace(records)

        total_prompt = 0
        total_completion = 0
        by_model: dict[str, dict[str, int]] = {}
        trace_count = 0

        for tid, events in grouped.items():
            info = self._build_trace_info(tid, events)

            if model and model not in info.models:
                continue

            total_prompt += info.total_prompt_tokens
            total_completion += info.total_completion_tokens
            trace_count += 1

            # Aggregate by_model from trace_summary
            summary = next((e for e in events if e.get("event_type") == "trace_summary"), None)
            if summary and summary.get("by_model"):
                for m, usage in summary["by_model"].items():
                    if model and m != model:
                        continue
                    if m not in by_model:
                        by_model[m] = {"prompt": 0, "completion": 0}
                    by_model[m]["prompt"] += usage.get("prompt", 0)
                    by_model[m]["completion"] += usage.get("completion", 0)
            else:
                # Fallback: aggregate from llm_end events
                for e in events:
                    if e.get("event_type") == "llm_end":
                        m = e.get("model", "unknown")
                        if model and m != model:
                            continue
                        if m not in by_model:
                            by_model[m] = {"prompt": 0, "completion": 0}
                        by_model[m]["prompt"] += e.get("prompt_tokens", 0) or 0
                        by_model[m]["completion"] += e.get("completion_tokens", 0) or 0

        return TokenUsageSummary(
            total_prompt=total_prompt,
            total_completion=total_completion,
            total_tokens=total_prompt + total_completion,
            by_model=by_model,
            trace_count=trace_count,
        )

    def get_token_usage_trend(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
        granularity: str = "hour",
        model: str | None = None,
    ) -> list[TrendPoint]:
        """Get token usage as a time series."""
        records = self._read_all_records(date_from, date_to)
        grouped = self._group_by_trace(records)

        # Collect trace summaries with timestamps
        buckets: dict[str, dict[str, int]] = {}

        for tid, events in grouped.items():
            info = self._build_trace_info(tid, events)
            if model and model not in info.models:
                continue
            if not info.started_at:
                continue

            # Determine bucket key
            if granularity == "day":
                bucket_key = info.started_at.strftime("%Y-%m-%d")
            else:
                bucket_key = info.started_at.strftime("%Y-%m-%dT%H:00")

            if bucket_key not in buckets:
                buckets[bucket_key] = {"prompt_tokens": 0, "completion_tokens": 0, "trace_count": 0}

            buckets[bucket_key]["prompt_tokens"] += info.total_prompt_tokens
            buckets[bucket_key]["completion_tokens"] += info.total_completion_tokens
            buckets[bucket_key]["trace_count"] += 1

        # Sort by timestamp and build TrendPoints
        result: list[TrendPoint] = []
        for key in sorted(buckets.keys()):
            b = buckets[key]
            result.append(TrendPoint(
                timestamp=key,
                prompt_tokens=b["prompt_tokens"],
                completion_tokens=b["completion_tokens"],
                total_tokens=b["prompt_tokens"] + b["completion_tokens"],
                trace_count=b["trace_count"],
            ))

        return result

    # ── Helpers ─────────────────────────────────────────────────────

    def get_models(self) -> list[str]:
        """Get distinct model names from all logs."""
        records = self._read_all_records()
        models: set[str] = set()
        for rec in records:
            if rec.get("model"):
                models.add(rec["model"])
            if rec.get("by_model"):
                models.update(rec["by_model"].keys())
        return sorted(models)

    def get_available_dates(self) -> list[str]:
        """Get dates that have log files."""
        if not self.log_dir.exists():
            return []
        dates: list[str] = []
        for f in sorted(self.log_dir.glob("spark-*.jsonl")):
            date_str = f.stem.replace("spark-", "")
            dates.append(date_str)
        return dates

    def export_traces(
        self,
        format: str = "json",
        date_from: str | None = None,
        date_to: str | None = None,
        model: str | None = None,
    ) -> str:
        """Export traces as JSON or CSV."""
        traces, _ = self.list_traces(
            page=1, page_size=10000,
            date_from=date_from, date_to=date_to, model=model,
        )

        if format == "csv":
            output = io.StringIO()
            if traces:
                writer = csv.DictWriter(output, fieldnames=traces[0].keys())
                writer.writeheader()
                writer.writerows(traces)
            return output.getvalue()

        return json.dumps(traces, ensure_ascii=False, indent=2)
