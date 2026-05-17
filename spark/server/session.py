# spark/server/session.py
"""Session management for WebSocket connections."""

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from spark.memory import ConversationMemory

if TYPE_CHECKING:
    from spark.server.session_store import SessionStore


@dataclass
class SessionMeta:
    """Metadata for a session."""
    session_id: str
    title: str = "新对话"
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    message_count: int = 0


class SessionManager:
    """
    Manages conversation sessions for WebSocket connections.

    Each session has its own conversation history. Supports optional
    file-based persistence via SessionStore.

    Args:
        max_history: Maximum messages per session in memory.
        sessions_dir: Optional directory for file-based persistence.
    """

    def __init__(
        self,
        max_history: int = 50,
        sessions_dir: Path | None = None,
    ):
        self.max_history = max_history
        self._sessions: dict[str, ConversationMemory] = {}
        self._meta: dict[str, SessionMeta] = {}
        self._store: SessionStore | None = None

        if sessions_dir is not None:
            from spark.server.session_store import SessionStore
            self._store = SessionStore(sessions_dir)
            self._load_all_meta_from_disk()

    def _load_all_meta_from_disk(self) -> None:
        """Load metadata for all sessions from disk into memory."""
        if self._store is None:
            return

        for session_id in self._store.list_session_ids():
            meta_dict = self._store.load_meta(session_id)
            if meta_dict:
                self._meta[session_id] = SessionMeta(
                    session_id=meta_dict["session_id"],
                    title=meta_dict.get("title", "新对话"),
                    created_at=datetime.fromisoformat(meta_dict["created_at"]),
                    updated_at=datetime.fromisoformat(meta_dict["updated_at"]),
                    message_count=meta_dict.get("message_count", 0),
                )

    def _session_dir_exists(self, session_id: str) -> bool:
        """Check if a session directory exists on disk."""
        if self._store is None:
            return False
        return (self._store.sessions_dir / session_id).exists()

    def _ensure_session(self, session_id: str) -> None:
        """Ensure a session exists with metadata."""
        # Check if we need to load from disk
        if session_id not in self._sessions:
            if self._store is not None and self._session_dir_exists(session_id):
                # Load messages from disk
                messages = self._store.load_messages(session_id)
                self._sessions[session_id] = ConversationMemory(
                    max_messages=self.max_history
                )
                self._sessions[session_id].set_messages(messages)
            else:
                # Create new in-memory session
                self._sessions[session_id] = ConversationMemory(
                    max_messages=self.max_history
                )

        if session_id not in self._meta:
            if self._store is not None:
                meta_dict = self._store.load_meta(session_id)
                if meta_dict:
                    self._meta[session_id] = SessionMeta(
                        session_id=meta_dict["session_id"],
                        title=meta_dict.get("title", "新对话"),
                        created_at=datetime.fromisoformat(meta_dict["created_at"]),
                        updated_at=datetime.fromisoformat(meta_dict["updated_at"]),
                        message_count=meta_dict.get("message_count", 0),
                    )
                    return
            # Create new metadata
            self._meta[session_id] = SessionMeta(session_id=session_id)

    def _save_meta(self, session_id: str) -> None:
        """Save metadata to disk if persistence is enabled."""
        if self._store is None:
            return

        meta = self._meta.get(session_id)
        if meta is None:
            return

        self._store.save_meta(session_id, {
            "session_id": meta.session_id,
            "title": meta.title,
            "created_at": meta.created_at.isoformat(),
            "updated_at": meta.updated_at.isoformat(),
            "message_count": meta.message_count,
        })

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

        # Create message dict
        now = datetime.now()
        message = {
            "role": role,
            "content": content,
            "timestamp": now.isoformat(),
        }

        # Add to in-memory history
        self._sessions[session_id].add_message(role, content)

        # Update metadata
        meta = self._meta[session_id]
        meta.message_count = len(self._sessions[session_id])
        meta.updated_at = now

        # Auto-title: use first user message
        if role == "user" and meta.title == "新对话":
            meta.title = content[:30] + ("..." if len(content) > 30 else "")

        # Persist to disk
        if self._store is not None:
            self._store.append_message(session_id, message)
            self._save_meta(session_id)

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

        # Persist to disk
        if self._store is not None:
            self._store.clear_messages(session_id)
            self._save_meta(session_id)

    def delete(self, session_id: str) -> None:
        """
        Delete a session entirely.

        Args:
            session_id: Unique session identifier.
        """
        self._sessions.pop(session_id, None)
        self._meta.pop(session_id, None)

        # Delete from disk
        if self._store is not None:
            self._store.delete_session(session_id)

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
