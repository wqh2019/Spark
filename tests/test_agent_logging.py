"""Integration tests for agent logging."""
import tempfile
import json
from pathlib import Path

import pytest

from spark import Agent, tool
from spark.logging import AgentLogger


@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


class TestAgentLogging:
    def test_agent_has_logger_attribute(self):
        """Test that agent has logger attribute."""
        logger = AgentLogger(enable_console=False, enable_file=False)
        agent = Agent(model="gpt-4", tools=[add], logger=logger)
        assert agent.logger is logger

    def test_agent_works_without_logger(self):
        """Test that agent works without logger."""
        agent = Agent(model="gpt-4", tools=[add])
        assert agent.logger is None
