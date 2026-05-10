"""
Spark Agent - Core agent implementation.
"""

from typing import Any, Callable

from spark.tool import Tool, tool


class Agent:
    """
    A lightweight agent that runs a simple ReAct loop.

    Args:
        model: The model to use (e.g., "gpt-4", "claude-3-opus")
        tools: List of tools available to the agent
        system_prompt: Optional system prompt
    """

    def __init__(
        self,
        model: str = "gpt-4",
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
    ):
        self.model = model
        self.tools = tools or []
        self.system_prompt = system_prompt or "You are a helpful assistant."
        self._tool_map = {t.name: t for t in self.tools}

    def run(self, message: str) -> str:
        """
        Run the agent with a user message.

        Args:
            message: The user message to process

        Returns:
            The agent's final response
        """
        # TODO: Implement the agent loop
        # 1. Send message to LLM
        # 2. If tool call needed, execute tool
        # 3. Loop until done
        raise NotImplementedError("Agent loop not yet implemented")

    def add_tool(self, func: Callable) -> None:
        """Add a tool to the agent."""
        t = tool(func)
        self.tools.append(t)
        self._tool_map[t.name] = t
