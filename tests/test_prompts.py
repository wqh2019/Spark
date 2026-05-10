"""
Tests for Prompts module.
"""

from spark.prompts import DEFAULT_SYSTEM_PROMPT, build_system_prompt


class TestDefaultPrompt:
    """Tests for default system prompt."""

    def test_default_prompt_exists(self):
        """Test that default prompt is not empty."""
        assert DEFAULT_SYSTEM_PROMPT
        assert "helpful" in DEFAULT_SYSTEM_PROMPT.lower()


class TestBuildSystemPrompt:
    """Tests for build_system_prompt function."""

    def test_role_only(self):
        """Test building prompt with role only."""
        prompt = build_system_prompt(role="intelligent assistant")
        assert "You are a intelligent assistant." in prompt

    def test_with_capabilities(self):
        """Test building prompt with capabilities."""
        prompt = build_system_prompt(
            role="search assistant",
            capabilities=["web search", "image search"]
        )
        assert "Capabilities:" in prompt
        assert "- web search" in prompt
        assert "- image search" in prompt

    def test_with_instructions(self):
        """Test building prompt with instructions."""
        prompt = build_system_prompt(
            role="assistant",
            instructions=["Be concise", "Be accurate"]
        )
        assert "Instructions:" in prompt
        assert "- Be concise" in prompt
        assert "- Be accurate" in prompt

    def test_full_prompt(self):
        """Test building prompt with all options."""
        prompt = build_system_prompt(
            role="AI expert",
            capabilities=["code review", "debugging"],
            instructions=["Explain clearly", "Provide examples"]
        )
        assert "You are a AI expert." in prompt
        assert "Capabilities:" in prompt
        assert "Instructions:" in prompt

    def test_empty_lists(self):
        """Test building prompt with empty lists."""
        prompt = build_system_prompt(
            role="assistant",
            capabilities=[],
            instructions=[]
        )
        assert "Capabilities:" not in prompt
        assert "Instructions:" not in prompt
