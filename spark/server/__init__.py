# spark/server/__init__.py
"""Spark Server - Web server for chat interface."""

from .session import SessionManager
from .app import app

__all__ = ["SessionManager", "app"]
