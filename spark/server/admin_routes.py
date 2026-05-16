"""Admin dashboard REST API and SSE endpoints."""

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from spark.server.log_broadcaster import broadcaster
from spark.server.log_service import LogService

router = APIRouter(prefix="/api")

# Shared LogService instance (uses default ./logs directory)
_log_service = LogService()


@router.get("/overview")
async def overview():
    """Overview statistics: trace count, token summary, models, dates."""
    usage = _log_service.get_token_usage()
    traces, total = _log_service.list_traces(page=1, page_size=5)
    return {
        "trace_count": total,
        "total_prompt_tokens": usage.total_prompt,
        "total_completion_tokens": usage.total_completion,
        "total_tokens": usage.total_tokens,
        "by_model": usage.by_model,
        "models": _log_service.get_models(),
        "dates": _log_service.get_available_dates(),
        "recent_traces": traces,
    }


@router.get("/traces")
async def list_traces(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    model: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    has_errors: bool | None = None,
):
    """List traces with pagination and filtering."""
    traces, total = _log_service.list_traces(
        page=page,
        page_size=page_size,
        model=model,
        date_from=date_from,
        date_to=date_to,
        has_errors=has_errors,
    )
    return {
        "traces": traces,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str):
    """Get a single trace with all events."""
    trace = _log_service.get_trace(trace_id)
    if trace is None:
        return {"error": "Trace not found"}
    return trace


@router.get("/token-usage")
async def token_usage(
    date_from: str | None = None,
    date_to: str | None = None,
    model: str | None = None,
):
    """Token usage summary."""
    usage = _log_service.get_token_usage(date_from=date_from, date_to=date_to, model=model)
    return {
        "total_prompt": usage.total_prompt,
        "total_completion": usage.total_completion,
        "total_tokens": usage.total_tokens,
        "by_model": usage.by_model,
        "trace_count": usage.trace_count,
    }


@router.get("/token-usage/trend")
async def token_usage_trend(
    date_from: str | None = None,
    date_to: str | None = None,
    granularity: str = Query("hour", pattern="^(hour|day)$"),
    model: str | None = None,
):
    """Token usage time series."""
    trend = _log_service.get_token_usage_trend(
        date_from=date_from, date_to=date_to,
        granularity=granularity, model=model,
    )
    return {
        "trend": [
            {
                "timestamp": p.timestamp,
                "prompt_tokens": p.prompt_tokens,
                "completion_tokens": p.completion_tokens,
                "total_tokens": p.total_tokens,
                "trace_count": p.trace_count,
            }
            for p in trend
        ],
    }


@router.get("/models")
async def models():
    """Distinct model names."""
    return {"models": _log_service.get_models()}


@router.get("/dates")
async def dates():
    """Dates that have log files."""
    return {"dates": _log_service.get_available_dates()}


@router.get("/export")
async def export_traces(
    format: str = Query("json", pattern="^(json|csv)$"),
    date_from: str | None = None,
    date_to: str | None = None,
    model: str | None = None,
):
    """Export traces as JSON or CSV."""
    data = _log_service.export_traces(
        format=format, date_from=date_from, date_to=date_to, model=model,
    )
    media_type = "text/csv" if format == "csv" else "application/json"
    filename = f"traces.{format}"
    return StreamingResponse(
        iter([data]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/stream")
async def stream(request: Request):
    """SSE endpoint for real-time log streaming."""

    async def event_generator():
        q = broadcaster.subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    record = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(record, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield ": keepalive\n\n"
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
