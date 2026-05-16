"""Broadcast new trace records to connected SSE clients."""

import asyncio
from typing import Any


class LogBroadcaster:
    """Fan-out new log records to all connected admin SSE clients."""

    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue."""
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        if q in self._queues:
            self._queues.remove(q)

    def broadcast(self, record: dict[str, Any]) -> None:
        """Push a record to all subscriber queues."""
        for q in self._queues:
            try:
                q.put_nowait(record)
            except asyncio.QueueFull:
                pass


broadcaster = LogBroadcaster()
