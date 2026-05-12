# spark/server/session.py
"""Session management for WebSocket connections."""

from dataclasses import dataclass, field
from typing import Optional

from spark.memory import ConversationMemory


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

    def get_history(self, session_id: str) -> list[dict]:
        """
        Get conversation history for a session.

        Args:
            session_id: Unique session identifier.

        Returns:
            List of message dictionaries.
        """
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationMemory(
                max_messages=self.max_history
            )
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
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationMemory(
                max_messages=self.max_history
            )
        self._sessions[session_id].add_message(role, content)

    def clear(self, session_id: str) -> None:
        """
        Clear conversation history for a session.

        Args:
            session_id: Unique session identifier.
        """
        if session_id in self._sessions:
            self._sessions[session_id].clear()

    def session_count(self) -> int:
        """Return number of active sessions."""
        return len(self._sessions)
