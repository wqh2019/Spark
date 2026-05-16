# spark/server/session.py
"""Session management for WebSocket connections."""

from dataclasses import dataclass, field
from datetime import datetime

from spark.memory import ConversationMemory


@dataclass
class SessionMeta:
    """Metadata for a session."""
    session_id: str
    title: str = "新对话"
    updated_at: datetime = field(default_factory=datetime.now)
    message_count: int = 0


@dataclass
class SessionManager:
    """
    Manages conversation sessions for WebSocket connections.

    Each session has its own conversation history.

    Args:
        max_history: Maximum messages per session history.
    """

    max_history: int = 50
    _sessions: dict[str, ConversationMemory] = field(default_factory=dict)
    _meta: dict[str, SessionMeta] = field(default_factory=dict)

    def _ensure_session(self, session_id: str) -> None:
        """Ensure a session exists with metadata."""
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationMemory(
                max_messages=self.max_history
            )
        if session_id not in self._meta:
            self._meta[session_id] = SessionMeta(session_id=session_id)

    def get_history(self, session_id: str) -> list[dict]:
        """
        Get conversation history for a session.

        Args:
            session_id: Unique session identifier.

        Returns:
            List of message dictionaries.
        """
        self._ensure_session(session_id)
        return self._sessions[session_id].get_messages()

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str
    ) -> None:
        """
        Add a message to session history.

        Args:
            session_id: Unique session identifier.
            role: Message role (user/assistant/system/tool).
            content: Message content.
        """
        self._ensure_session(session_id)
        self._sessions[session_id].add_message(role, content)

        meta = self._meta[session_id]
        meta.message_count = len(self._sessions[session_id])
        meta.updated_at = datetime.now()

        # Auto-title: use first user message
        if role == "user" and meta.title == "新对话":
            meta.title = content[:30] + ("..." if len(content) > 30 else "")

    def clear(self, session_id: str) -> None:
        """
        Clear conversation history for a session.

        Args:
            session_id: Unique session identifier.
        """
        if session_id in self._sessions:
            self._sessions[session_id].clear()
        if session_id in self._meta:
            self._meta[session_id].message_count = 0
            self._meta[session_id].title = "新对话"

    def delete(self, session_id: str) -> None:
        """
        Delete a session entirely.

        Args:
            session_id: Unique session identifier.
        """
        self._sessions.pop(session_id, None)
        self._meta.pop(session_id, None)

    def list_sessions(self, limit: int = 10) -> list[dict]:
        """
        List sessions sorted by most recently updated.

        Args:
            limit: Maximum number of sessions to return.

        Returns:
            List of session metadata dicts.
        """
        sorted_meta = sorted(
            self._meta.values(),
            key=lambda m: m.updated_at,
            reverse=True,
        )
        return [
            {
                "session_id": m.session_id,
                "title": m.title,
                "updated_at": m.updated_at.isoformat(),
                "message_count": m.message_count,
            }
            for m in sorted_meta[:limit]
        ]

    def session_count(self) -> int:
        """Return number of active sessions."""
        return len(self._sessions)
